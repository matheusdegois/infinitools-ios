"""Resize the original Infinitools branding; never generates replacement artwork."""
from pathlib import Path
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = root / 'Infinitools/Resources/Assets.xcassets'
icons = assets / 'AppIcon.appiconset'
icons.mkdir(parents=True, exist_ok=True)
source = Image.open(root / 'Infinitools/Resources/brand.png').convert('RGBA')
images = []
for idiom, sizes, scales in [('iphone', [20, 29, 40, 60], [2, 3]), ('ipad', [20, 29, 40, 76], [1, 2]), ('ipad', [83.5], [2]), ('ios-marketing', [1024], [1])]:
    for size in sizes:
        for scale in scales:
            pixels = int(size * scale)
            name = f'icon-{pixels}.png'
            image = Image.new('RGB', (pixels, pixels), 'white')
            resized = source.resize((pixels, pixels), Image.Resampling.LANCZOS)
            image.paste(resized, mask=resized.getchannel('A'))
            image.save(icons / name)
            images.append({'idiom': idiom, 'size': f'{size}x{size}', 'scale': f'{scale}x', 'filename': name})
(icons / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2))
(assets / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}))
accent = assets / 'AccentColor.colorset'
accent.mkdir(exist_ok=True)
(accent / 'Contents.json').write_text(json.dumps({'colors': [{'idiom': 'universal', 'color': {'color-space': 'srgb', 'components': {'red': '0.870', 'green': '0.280', 'blue': '0.100', 'alpha': '1.000'}}}], 'info': {'author': 'xcode', 'version': 1}}, indent=2))
print(f'{len(images)} variantes de ícone criadas da marca original.')
