-- Permanent deletion of a form (Daniel 2026-09-26): a published version may be deleted only by the explicit delete
-- command, which sets hintek.allow_form_delete for its own transaction. A version that any protocol uses can still
-- never be deleted: the foreign key from "WorkflowTask" is ON DELETE RESTRICT. Updates stay forbidden.
CREATE OR REPLACE FUNCTION form_template_version_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('hintek.allow_form_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Publicerade formulärversioner kan inte ändras eller raderas.';
END;
$$ LANGUAGE plpgsql;
