-- Remove FK constraints from old users table (now using company_users)
ALTER TABLE app_conversations DROP CONSTRAINT IF EXISTS app_conversations_user_id_fkey;
ALTER TABLE app_analyses DROP CONSTRAINT IF EXISTS app_analyses_user_id_fkey;
ALTER TABLE app_feedback DROP CONSTRAINT IF EXISTS app_feedback_user_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
ALTER TABLE kanban_cards DROP CONSTRAINT IF EXISTS kanban_cards_created_by_fkey;
