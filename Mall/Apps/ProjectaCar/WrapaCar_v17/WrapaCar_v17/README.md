# WrapaCar v17

The app is `WrapaCar_v17.html`. Open it in a browser; it needs no install.

To try the new intake feature:

1. Choose **Bumper with intakes** in the model list.
2. Click **Find intakes**, then **Accept all**.
3. Unwrap.
4. Draw across a vent in **Vector art** to see how the art lands.

| File | What it is |
|---|---|
| `WrapaCar_v17.html` | the app |
| `patch_v16_to_v17.py` | the atomic patch that turns the shipped v16 into v17: `python3 patch_v16_to_v17.py WrapaCar_v16.html WrapaCar_v17.html` |
| `WrapaCar_v16.html` | the shipped v16, the baseline the patch and the tests compare against |
| `CHANGELOG-WrapaCar.md` | what changed, and what the tests found |
| `tests/` | the validation suite: `validate.sh` and its tiers |
| `tests/shots/` | screenshots from the browser tier |
| `validation-log.txt` | the full run of `validate.sh` for this release |

## Running the validation

```
npm install            # three 0.147.0; playwright-core is optional
bash tests/validate.sh
```

The browser tier runs only when Chromium and playwright-core are there. Set
`CHROMIUM` to point at another Chromium binary.
