CREATE TABLE IF NOT EXISTS wellness_product_events (
  event_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_name VARCHAR(60) NOT NULL CHECK (event_name IN (
    'daily_check_in_prompted',
    'daily_check_in_completed',
    'weekly_pulse_prompted',
    'weekly_pulse_completed',
    'baseline_refresh_prompted',
    'baseline_refresh_completed',
    'nutrition_nudge_shown',
    'exercise_recommendation_shown',
    'exercise_recommendation_selected',
    'exercise_goal_completed'
  )),
  event_key VARCHAR(160) NOT NULL,
  correlation_key VARCHAR(160),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(dimensions) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_name, event_key)
);

CREATE INDEX IF NOT EXISTS wellness_product_events_rollout_idx
  ON wellness_product_events (event_name, occurred_at DESC);

CREATE OR REPLACE VIEW core_intelligence_rollout_event_counts_daily AS
SELECT
  occurred_at::DATE AS event_date,
  event_name,
  dimensions->>'macro_focus' AS macro_focus,
  dimensions->>'food_group' AS food_group,
  dimensions->>'exercise_category' AS exercise_category,
  dimensions->>'is_none_today' AS is_none_today,
  COUNT(*) AS event_count,
  COUNT(DISTINCT user_id) AS user_count
FROM wellness_product_events
GROUP BY 1, 2, 3, 4, 5, 6;

CREATE OR REPLACE VIEW core_intelligence_rollout_rates_daily AS
WITH daily_counts AS (
  SELECT
    occurred_at::DATE AS event_date,
    COUNT(*) FILTER (WHERE event_name = 'daily_check_in_prompted') AS daily_prompted,
    COUNT(*) FILTER (WHERE event_name = 'daily_check_in_completed') AS daily_completed,
    COUNT(*) FILTER (WHERE event_name = 'weekly_pulse_prompted') AS weekly_prompted,
    COUNT(*) FILTER (WHERE event_name = 'weekly_pulse_completed') AS weekly_completed,
    COUNT(*) FILTER (WHERE event_name = 'baseline_refresh_prompted') AS baseline_prompted,
    COUNT(*) FILTER (WHERE event_name = 'baseline_refresh_completed') AS baseline_completed,
    COUNT(*) FILTER (WHERE event_name = 'exercise_recommendation_shown') AS exercise_shown,
    COUNT(*) FILTER (WHERE event_name = 'exercise_recommendation_selected') AS exercise_selected,
    COUNT(*) FILTER (WHERE event_name = 'exercise_goal_completed') AS exercise_completed,
    COUNT(*) FILTER (
      WHERE event_name = 'exercise_recommendation_selected'
        AND dimensions->>'is_none_today' = 'true'
    ) AS none_today_selected
  FROM wellness_product_events
  GROUP BY 1
), metrics AS (
  SELECT event_date, 'daily_check_in_completion'::TEXT AS metric_name,
    daily_completed AS numerator, daily_prompted AS denominator FROM daily_counts
  UNION ALL
  SELECT event_date, 'weekly_pulse_completion', weekly_completed, weekly_prompted FROM daily_counts
  UNION ALL
  SELECT event_date, 'baseline_refresh_completion', baseline_completed, baseline_prompted FROM daily_counts
  UNION ALL
  SELECT event_date, 'exercise_recommendation_selection', exercise_selected, exercise_shown FROM daily_counts
  UNION ALL
  SELECT event_date, 'exercise_goal_completion', exercise_completed, exercise_selected FROM daily_counts
  UNION ALL
  SELECT event_date, 'exercise_none_today_selection', none_today_selected, exercise_selected FROM daily_counts
)
SELECT
  event_date,
  metric_name,
  numerator,
  denominator,
  ROUND(100.0 * numerator / NULLIF(denominator, 0), 2) AS rate_percent
FROM metrics;

CREATE OR REPLACE VIEW core_intelligence_confidence_distribution_daily AS
SELECT
  score_date,
  scoring_version,
  CASE
    WHEN confidence_score < 50 THEN 'limited'
    WHEN confidence_score < 70 THEN 'developing'
    ELSE 'strong'
  END AS confidence_band,
  COUNT(*) AS score_count,
  COUNT(DISTINCT user_id) AS user_count
FROM burnout_score_history
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW core_intelligence_nudge_outcomes_daily AS
SELECT
  created_at::DATE AS event_date,
  nudge_type,
  COALESCE(metadata->>'recommended_focus', metadata->>'macro_focus', 'unspecified')
    AS recommendation_focus,
  status,
  COUNT(*) AS event_count,
  COUNT(DISTINCT user_id) AS user_count
FROM nudge_events
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW core_intelligence_repeat_recommendations_daily AS
WITH shown AS (
  SELECT
    user_id,
    event_name,
    occurred_at,
    COALESCE(
      dimensions->>'recommendation_key',
      dimensions->>'macro_focus',
      dimensions->>'exercise_category',
      'unspecified'
    ) AS recommendation_focus,
    LAG(occurred_at) OVER (
      PARTITION BY user_id, event_name, COALESCE(
        dimensions->>'recommendation_key',
        dimensions->>'macro_focus',
        dimensions->>'exercise_category',
        'unspecified'
      )
      ORDER BY occurred_at
    ) AS previous_shown_at
  FROM wellness_product_events
  WHERE event_name IN ('nutrition_nudge_shown', 'exercise_recommendation_shown')
)
SELECT
  occurred_at::DATE AS event_date,
  event_name,
  recommendation_focus,
  COUNT(*) AS shown_count,
  COUNT(*) FILTER (
    WHERE previous_shown_at IS NOT NULL
      AND occurred_at - previous_shown_at <= INTERVAL '7 days'
  ) AS repeated_within_seven_days_count,
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE previous_shown_at IS NOT NULL
        AND occurred_at - previous_shown_at <= INTERVAL '7 days'
    ) / NULLIF(COUNT(*), 0),
    2
  ) AS repeat_rate_percent
FROM shown
GROUP BY 1, 2, 3;
