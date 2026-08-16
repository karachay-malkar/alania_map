#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STRATEGIES = "['stable-vector-far-contour','stable-vector-detailed-area-match'].includes(data.regionalSnow?.displayStrategy)"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        if new in text:
            return
        raise RuntimeError(f'{label}: expected token not found in {path}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def main() -> None:
    page = ROOT / 'assets/map-page.js'
    replace_once(
        page,
        "data.regionalSnow?.displayStrategy === 'stable-vector-far-contour'",
        STRATEGIES,
        'map-page stable snow transport strategy',
    )

    index = ROOT / 'index.html'
    text = index.read_text(encoding='utf-8')
    if '?v=7.3.1-snow4' not in text:
        if '?v=7.3.1' not in text:
            raise RuntimeError('index 7.3.1 cache tokens not found')
        text = text.replace('?v=7.3.1', '?v=7.3.1-snow4')
        index.write_text(text, encoding='utf-8')

    runtime = ROOT / 'tests/runtime-contract.mjs'
    text = runtime.read_text(encoding='utf-8')
    old = r"assert.match(indexSource, /map-presentation-r2\.js\?v=7\.3\.1/);"
    new = r"assert.match(indexSource, /map-presentation-r2\.js\?v=7\.3\.1-snow4/);"
    if new not in text:
        if old not in text:
            raise RuntimeError('runtime index cache assertion not found')
        runtime.write_text(text.replace(old, new, 1), encoding='utf-8')

    page_text = page.read_text(encoding='utf-8')
    assert STRATEGIES in page_text
    assert "sourceId:'snow-permanent'" in page_text
    assert "sourceId:'snow-seasonal'" in page_text
    print('7.3.1 snow runtime transport/cache patch: ok')


if __name__ == '__main__':
    main()
