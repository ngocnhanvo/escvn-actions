import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).parents[1] / 'scripts' / 'esc-delta-package.py'
spec = importlib.util.spec_from_file_location('esc_delta_package', MODULE)
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


class DeltaTests(unittest.TestCase):
    def test_reuse_only_exact_bytes_and_protect_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'client/_astro').mkdir(parents=True)
            (root/'server').mkdir()
            (root/'client/index.html').write_text('<html>new</html>')
            (root/'server/entry.mjs').write_text('export {}')
            (root/'client/_astro/a.css').write_text('same')
            (root/'client/_astro/b.js').write_text('changed')
            remote = {'_astro/a.css': {'size': 4, 'sha256': delta.checksum(root/'client/_astro/a.css')},
                      '_astro/b.js': {'size': 8, 'sha256': 'a'*64}}
            count, reused, saved = delta.make_delta(root, remote)
            self.assertEqual((count,reused,saved), (2,1,4))
            self.assertTrue((root/'client/index.html').exists())
            self.assertFalse((root/'client/_astro/a.css').exists())
            self.assertTrue((root/'client/_astro/b.js').exists())
            self.assertTrue((root/'server/entry.mjs').exists())
            marker=json.loads((root/'esc-delta-manifest.json').read_text())
            self.assertEqual(marker['reuse'], ['_astro/a.css'])

    def test_invalid_and_protected_assets(self):
        for name in ('index.html','robots.txt','llms.txt','../.env','a//b.webp','client/.env','x/../../passwd','space here.png'):
            self.assertFalse(delta.eligible(name), name)
        self.assertTrue(delta.eligible('images/a.webp'))
        with self.assertRaises(ValueError):
            delta.validate_remote({'../.env': {'size':1, 'sha256':'a'*64}})


if __name__ == '__main__': unittest.main()
