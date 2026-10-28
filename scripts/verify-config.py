"""Parse Apple configuration files without pretending to compile an Apple target."""
from pathlib import Path
import json
import plistlib
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
paths = [root / d / n for d in ['Infinitools', 'ShareExtension'] for n in ['Info.plist', 'PrivacyInfo.xcprivacy']]
paths += [root / 'Infinitools/Infinitools.entitlements', root / 'ShareExtension/Share.entitlements']
loaded = {p.relative_to(root).as_posix(): plistlib.loads(p.read_bytes()) for p in paths}
app = loaded['Infinitools/Info.plist']
assert app['NSAppTransportSecurity'] == {'NSAllowsLocalNetworking': True}
assert app['CFBundlePackageType'] == 'APPL'
assert len(app['CFBundleDocumentTypes']) == 1
assert 'NSMicrophoneUsageDescription' not in app
for key in ['Infinitools/Infinitools.entitlements', 'ShareExtension/Share.entitlements']:
    assert loaded[key]['com.apple.security.application-groups'] == ['group.br.com.infinitools.ios']
scheme = ET.parse(root / 'Infinitools.xcodeproj/xcshareddata/xcschemes/Infinitools.xcscheme')
assert len(scheme.findall('.//TestableReference')) == 2
assert scheme.find('.//EnvironmentVariable[@key="INFINITOOLS_UNIT_TEST_HOST"]').attrib['value'] == '1'
icons = root / 'Infinitools/Resources/Assets.xcassets/AppIcon.appiconset'
entries = json.loads((icons / 'Contents.json').read_text())['images']
assert len(entries) == 18
for entry in entries:
    assert (icons / entry['filename']).is_file()
report = {'plistsParsed': len(paths), 'schemeParsed': True, 'iconVariants': len(entries), 'note': 'Configuration parsing only; no Xcode or Swift compilation.'}
target = root / 'docs/verification/config.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
