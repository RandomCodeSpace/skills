import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_ralph():
    module_path = Path(__file__).resolve().parents[1] / "ralph.py"
    spec = importlib.util.spec_from_file_location("ralph", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["ralph"] = module
    spec.loader.exec_module(module)
    return module


def load_init():
    module_path = Path(__file__).resolve().parents[1] / "init.py"
    spec = importlib.util.spec_from_file_location("ralph_init", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["ralph_init"] = module
    spec.loader.exec_module(module)
    return module


ralph = load_ralph()
ralph_init = load_init()


class RalphLoopTests(unittest.TestCase):
    def write_config(self, tmp: Path, **overrides) -> Path:
        workspace = tmp / ".ralph"
        workspace.mkdir()
        prompt = workspace / "PROMPT.md"
        prompt.write_text("do one thing\n", encoding="utf-8")
        config = {
            "command": [sys.executable, "-c", "print('ok')"],
            "prompt_file": str(prompt),
            "workspace": str(workspace),
            "log_dir": str(workspace / "log"),
            "max_iterations": 1,
            "max_wall_seconds": 60,
            "sleep_between_seconds": 0,
            "exit_code_failure_threshold": 2,
            "iteration_timeout_seconds": 30,
            "auto_commit": False,
            "git_branch": None,
            "env": {},
        }
        config.update(overrides)
        path = workspace / "config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        return path

    def test_null_timeout_is_normalized_to_default(self):
        with tempfile.TemporaryDirectory() as d:
            config_path = self.write_config(
                Path(d), iteration_timeout_seconds=None
            )

            cfg = ralph.Config.load(config_path)

            self.assertEqual(cfg.iteration_timeout_seconds, 30 * 60)

    def test_done_and_stop_have_distinct_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            config_path = self.write_config(Path(d))
            cfg = ralph.Config.load(config_path)

            (Path(cfg.workspace) / "DONE").write_text("complete\n")
            done = ralph.check_stop_conditions(cfg, 1, 0, 0)
            (Path(cfg.workspace) / "DONE").unlink()
            (Path(cfg.workspace) / "STOP").write_text("stop\n")
            stopped = ralph.check_stop_conditions(cfg, 1, 0, 0)

            self.assertIsNotNone(done)
            self.assertIsNotNone(stopped)
            self.assertEqual(done.exit_code, 0)
            self.assertNotEqual(stopped.exit_code, 0)

    def test_timeouts_count_toward_failure_threshold(self):
        with tempfile.TemporaryDirectory() as d:
            config_path = self.write_config(
                Path(d),
                command=[sys.executable, "-c", "import time; time.sleep(2)"],
                max_iterations=5,
                exit_code_failure_threshold=2,
                iteration_timeout_seconds=0.1,
            )

            code = ralph.main(["--config", str(config_path)])

            self.assertEqual(code, ralph.EXIT_FAILURE_THRESHOLD)

    def test_invocation_adds_workspace_to_gitignore(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            config_path = self.write_config(
                root,
                command=[
                    sys.executable,
                    "-c",
                    (
                        "import os; from pathlib import Path; "
                        "Path(os.environ['RALPH_WORKSPACE'], 'DONE')"
                        ".write_text('done\\n')"
                    ),
                ],
            )
            old_cwd = Path.cwd()
            try:
                import os

                os.chdir(root)
                code = ralph.main(["--config", str(config_path)])
            finally:
                os.chdir(old_cwd)

            self.assertEqual(code, 0)
            self.assertIn(".ralph/", (root / ".gitignore").read_text())

    def test_prepare_subagents_creates_worker_configs(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            config_path = self.write_config(root)
            cfg = ralph.Config.load(config_path)

            workers = ralph.prepare_subagents(cfg, 2, Path(config_path))

            self.assertEqual(len(workers), 2)
            for index, worker_config in enumerate(workers, start=1):
                data = json.loads(worker_config.read_text())
                self.assertEqual(data["subagents"]["count"], 0)
                self.assertIn(f"agent-{index}", data["workspace"])
                self.assertTrue(Path(data["prompt_file"]).exists())

    def test_run_subagents_supervises_child_workers(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            config_path = self.write_config(
                root,
                command=[
                    sys.executable,
                    "-c",
                    (
                        "import os; from pathlib import Path; "
                        "Path(os.environ['RALPH_WORKSPACE'], 'DONE')"
                        ".write_text('done\\n')"
                    ),
                ],
            )
            cfg = ralph.Config.load(config_path)

            code = ralph.run_subagents(cfg, 2, config_path)

            self.assertEqual(code, 0)
            summary = Path(cfg.log_dir) / "subagents-summary.json"
            self.assertTrue(summary.exists())
            data = json.loads(summary.read_text())
            self.assertEqual(data["exit_codes"], {"1": 0, "2": 0})

    def test_copilot_adapter_is_not_gh_copilot(self):
        command = ralph_init.ADAPTERS["copilot"]["command"]

        self.assertNotEqual(command[:2], ["gh", "copilot"])
        self.assertNotIn(" ".join(["gh", "copilot"]), " ".join(command).lower())

    def test_default_adapter_is_generic(self):
        with tempfile.TemporaryDirectory() as d:
            workspace = Path(d) / ".ralph"

            code = ralph_init.main(["--workspace", str(workspace)])

            self.assertEqual(code, 0)
            data = json.loads((workspace / "config.json").read_text())
            self.assertEqual(
                data["command"], ralph_init.ADAPTERS["generic"]["command"]
            )


if __name__ == "__main__":
    unittest.main()
