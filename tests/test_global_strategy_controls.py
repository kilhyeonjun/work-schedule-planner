from pathlib import Path

ROOT = Path(__file__).parents[1] / "web" / "flex-work-schedule" / "src"


def test_strategy_controls_are_global_immediate_and_single_source():
    ui = (ROOT / "ui.tsx").read_text(encoding="utf-8")
    main = (ROOT / "main.tsx").read_text(encoding="utf-8")
    plan = (ROOT / "tabs" / "Plan.tsx").read_text(encoding="utf-8")
    lib = (ROOT / "lib.ts").read_text(encoding="utf-8")
    e2e = (ROOT.parent / "tests" / "e2e" / "demo.spec.ts").read_text(encoding="utf-8")

    assert "settings: WorkSettings" in ui
    assert "setSettings: (settings: WorkSettings) => void" in ui
    assert 'type="range"' in ui
    assert "step={1}" in ui
    assert "1분 감소" in ui and "1분 증가" in ui
    assert "업데이트 중" in ui
    assert "settings={settings}" in main
    assert "setSettings: setUserSettings" in main
    assert "loading={loading}" in main
    assert "strategyBaseline" in main
    assert "draftSettings" not in main
    assert "plan-tuning" not in plan
    assert "AbortController" in lib
    assert "signal: controller.signal" in lib
    assert "Math.max(defaultWorkSettings.shortDayMinutes" in lib
    assert "key: 'shortDayMinutes', min: defaultWorkSettings.shortDayMinutes" in ui
    assert "element.inert = true" in ui
    assert "baseline?.target" in ui and "baseline?.settings" in ui
    assert "global strategy modal resets to its initial baseline" in e2e
