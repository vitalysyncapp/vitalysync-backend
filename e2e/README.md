# Check-in integration tests

The questionnaire suite runs the real Flutter web build, Express routes, and
PostgreSQL saves. It checks 22 baseline items, 14 ordinary daily inputs, and
weekly days with 9 practical inputs plus 11 reflections (5/3/3).

Build the sibling frontend against the suite's local API:

```powershell
cd ../vitalysync-frontend
flutter build web --release --dart-define=API_BASE_URL=http://127.0.0.1:4181
cd ../vitalysync-backend
npx playwright install chromium
npx playwright test --config playwright.check-in.config.js
```

The configured PostgreSQL role needs `CREATEDB`. Ports 4173 and 4181 must be
available. The fixture creates a uniquely named `vitalysync_e2e_*` database,
applies all checked-in migrations there, creates test users, and drops that
database during teardown. It does not migrate or insert into the configured
application database. Environment files are only read; test tokens and disabled
external integrations are scoped to the test process. Browser evidence is saved
under ignored `test-results/check-in/`.

Use this dedicated config. The older `playwright.config.js` and `report.spec.js`
use the configured application database and are not part of this isolated run.

The API test checks stored rows against independent expected results, including
daily scores of 4.51 and 6.52 for its specified inputs. Weekly fixture totals are
15/9/12, with means 3/3/4. It also checks invalid-answer rejection, ignores
client-supplied scores, and verifies that weekly saves do not change the daily
score or streak. Database DATE values must round-trip without timezone shifts.

The Chromium test operates Flutter's accessible buttons, submits the nine-input
daily form and eleven-item weekly form through the real API, checks PostgreSQL,
and reloads the app to verify persisted results. External weather and AI services
are disabled, so weather-unavailable messages during this suite are expected.
