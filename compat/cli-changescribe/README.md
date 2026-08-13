# ChangeScribe compatibility bridge

ChangeScribe has been renamed to [Diffwright](https://www.npmjs.com/package/diffwright).
This final compatibility package preserves the `changescribe` command while
running Diffwright's implementation.

## Migrate

For a global installation:

```bash
npm uninstall -g cli-changescribe
npm install -g diffwright
```

Then replace `changescribe` with `diffwright` in scripts and documentation.
Existing `changescribe` commands continue to work through this bridge, but all
future releases will be published as `diffwright`.
