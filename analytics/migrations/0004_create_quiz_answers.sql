-- How It Works practice quizzes (frontend/src/tutorial/QuizPlayer.tsx): one
-- row per answered question, sent with the usage batches (POST /sync, the
-- `quiz` array) and tied to the same visitor/visit ids as everything else.
--
-- A quiz is a lesson's 3-4 easy questions. Nothing is scored in the app, so
-- "accuracy" here means: answered right with no wrong attempt first.
--
--   quiz_id        'basics/singles', 'simple', 'medusa', 'dragon', 'dynamic',
--                  'uniqueness/ur-type-1', 'double/double-plain-dragon-colouring', ...
--                  (tab, then the sub-tab's title as a slug - quizIdFor in quizExamples.ts)
--   run_id         one pass through a quiz; "Practise again" starts a new run
--   question_id    stable name of the question within its quiz
--   question_kind  choice (pick a button) / cells (tap cells) /
--                  candidates (tap pencil marks) / colour (carry a colouring on)
--   wrong_attempts wrong taps or picks before the right answer
--   first_try      1 = no wrong attempt
--   revealed       1 = the answer was ringed for them (after two wrong taps)
--   duration_ms    from the question appearing to the right answer
CREATE TABLE quiz_answers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id          TEXT    NOT NULL,
  visitor_id        TEXT    NOT NULL,
  answered_at       TEXT    NOT NULL,
  quiz_id           TEXT    NOT NULL,
  run_id            TEXT    NOT NULL,
  question_id       TEXT    NOT NULL,
  question_kind     TEXT    NOT NULL,
  question_index    INTEGER NOT NULL,          -- 0 = the quiz's first question
  question_count    INTEGER NOT NULL,          -- questions in the quiz
  wrong_attempts    INTEGER NOT NULL DEFAULT 0,
  first_try         INTEGER NOT NULL,
  revealed          INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER,
  UNIQUE (run_id, question_index)
);

CREATE INDEX idx_quiz_answers_visitor ON quiz_answers (visitor_id, quiz_id);
CREATE INDEX idx_quiz_answers_quiz ON quiz_answers (quiz_id, question_index);
CREATE INDEX idx_quiz_answers_answered ON quiz_answers (answered_at);

-- Ready-made views (see README.md). Like the usage views, they leave out bots
-- and excluded visitors.

-- One row per pass through a quiz: who, which quiz, finished or not, accuracy.
CREATE VIEW quiz_runs AS
SELECT q.run_id, q.visitor_id, vr.label AS visitor_label, q.visit_id, q.quiz_id,
       MIN(q.answered_at) AS started_at,
       MAX(q.answered_at) AS last_answer_at,
       COUNT(*) AS answered,
       MAX(q.question_count) AS questions,
       COUNT(*) >= MAX(q.question_count) AS completed,
       SUM(q.first_try) AS first_try_correct,
       ROUND(100.0 * SUM(q.first_try) / COUNT(*), 0) AS accuracy_pct,
       SUM(q.wrong_attempts) AS wrong_attempts,
       SUM(q.revealed) AS revealed,
       ROUND(SUM(q.duration_ms) / 1000.0, 1) AS seconds
FROM quiz_answers q
JOIN visitors vr ON vr.visitor_id = q.visitor_id
WHERE vr.is_bot = 0 AND vr.excluded = 0
GROUP BY q.run_id;

-- One row per visitor and quiz: which user has done which quiz, how often,
-- and how well (first run, best run, average).
CREATE VIEW quiz_visitor_summary AS
SELECT r.visitor_id, r.visitor_label, r.quiz_id,
       COUNT(*) AS runs,
       SUM(r.completed) AS completed_runs,
       MIN(r.started_at) AS first_run_at,
       MAX(r.last_answer_at) AS last_run_at,
       (SELECT f.accuracy_pct FROM quiz_runs f
         WHERE f.visitor_id = r.visitor_id AND f.quiz_id = r.quiz_id
         ORDER BY f.started_at LIMIT 1) AS first_run_accuracy_pct,
       MAX(r.accuracy_pct) AS best_accuracy_pct,
       ROUND(AVG(r.accuracy_pct), 0) AS avg_accuracy_pct,
       SUM(r.wrong_attempts) AS wrong_attempts,
       ROUND(SUM(r.seconds), 1) AS seconds
FROM quiz_runs r
GROUP BY r.visitor_id, r.quiz_id;

-- One row per quiz: how many people try it, finish it, and how they do.
CREATE VIEW quiz_summary AS
SELECT r.quiz_id,
       COUNT(DISTINCT r.visitor_id) AS visitors,
       COUNT(*) AS runs,
       SUM(r.completed) AS completed_runs,
       ROUND(100.0 * SUM(r.completed) / COUNT(*), 0) AS completion_pct,
       ROUND(AVG(r.accuracy_pct), 0) AS avg_accuracy_pct,
       ROUND(AVG(r.seconds), 0) AS avg_seconds
FROM quiz_runs r
GROUP BY r.quiz_id;

-- One row per question: which ones people get wrong (candidates for rewording).
CREATE VIEW quiz_question_summary AS
SELECT q.quiz_id, q.question_index, q.question_id, q.question_kind,
       COUNT(*) AS answers,
       COUNT(DISTINCT q.visitor_id) AS visitors,
       ROUND(100.0 * AVG(q.first_try), 0) AS first_try_pct,
       ROUND(AVG(q.wrong_attempts), 2) AS avg_wrong_attempts,
       SUM(q.revealed) AS revealed,
       ROUND(AVG(q.duration_ms) / 1000.0, 1) AS avg_seconds
FROM quiz_answers q
JOIN visitors vr ON vr.visitor_id = q.visitor_id
WHERE vr.is_bot = 0 AND vr.excluded = 0
GROUP BY q.quiz_id, q.question_id;
