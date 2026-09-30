-- M2.1b: key-pair (SNOWFLAKE_JWT) authentication.
--
-- `keypair` profiles store the path of the user's PEM private key. The key
-- itself stays in the user's file and is never copied into the app; its
-- optional passphrase lives in safeStorage under
-- `profile:${id}:private_key_passphrase`, never in SQLite. NULL for every
-- other auth method.

ALTER TABLE connection_profiles ADD COLUMN private_key_path TEXT;
