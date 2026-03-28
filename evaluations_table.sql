-- ============================================
-- EVALUATIONS TABLE + RLS
-- Rulează în Supabase SQL Editor
-- ============================================

-- Crează tabelul evaluations (dacă nu există deja)
CREATE TABLE IF NOT EXISTS public.evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  suggestion_text text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT 'sugestie',
  tier text NOT NULL DEFAULT 'basic',
  score integer DEFAULT 0,
  level text,
  criteria jsonb DEFAULT '[]'::jsonb,
  problems jsonb DEFAULT '[]'::jsonb,
  improved_text text DEFAULT '',
  changes_text text DEFAULT '',
  suggestion_type text DEFAULT '',
  module text NOT NULL DEFAULT 'evaluator',
  language text DEFAULT 'ro',
  device text,
  local_id text,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexuri pentru performanță
CREATE INDEX IF NOT EXISTS idx_evaluations_user ON evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_created ON evaluations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluations_local_id ON evaluations(local_id);

-- RLS: fiecare user vede/inserează doar evaluările proprii
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;

-- Drop dacă există deja (safe re-run)
DROP POLICY IF EXISTS "Users read own evals" ON evaluations;
DROP POLICY IF EXISTS "Users insert own evals" ON evaluations;

CREATE POLICY "Users read own evals" ON evaluations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own evals" ON evaluations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
