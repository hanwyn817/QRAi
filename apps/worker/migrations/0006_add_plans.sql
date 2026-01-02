ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';

CREATE TABLE model_access (
  model_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  PRIMARY KEY (model_id, plan),
  FOREIGN KEY(model_id) REFERENCES models(id)
);

INSERT INTO model_access (model_id, plan)
SELECT id, 'free' FROM models;
