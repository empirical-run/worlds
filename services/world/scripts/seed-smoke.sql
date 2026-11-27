INSERT OR IGNORE INTO teams (id, name, updated_at) VALUES ('team_smoketest00000000000', 'Smoke test', unixepoch() * 1000);
INSERT OR IGNORE INTO api_keys (id, team_id, name, key_hash, prefix, updated_at) VALUES ('key_smoketest000000000000', 'team_smoketest00000000000', 'smoke', 'o7EgYgigSunKe0CDztX3S2v_8Pum9tD-Rw8KxHa8pp0', 'wk_live_smoke0', unixepoch() * 1000);
INSERT OR IGNORE INTO worlds (id, team_id, name, updated_at) VALUES ('world_smoketest0000000000', 'team_smoketest00000000000', 'Smoke test', unixepoch() * 1000);
