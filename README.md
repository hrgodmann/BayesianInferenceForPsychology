# Bayesville

Calculation practice for Bayesian Inference for Psychology. The autumn watercolor village opens onto seven skills and linked exam scenarios. Choose a calculation and start immediately. Each new question has fresh numbers.

## Practice

- **Probability rules:** conditional probabilities from a two-way table, overlapping events, total probability, and missing conditional rates.
- **Bayes’ rule:** posterior probabilities with two or three explanations, including successes, failures, mixed observations, and a general law compared with a beta alternative.
- **Sequences & counts:** ordered sequences, exact binomial counts, and complements.
- **Learning a proportion:** beta updates, posterior means, prior and posterior count prediction, and Laplace’s rule of succession.
- **Combining predictions:** prior mixtures of fixed-rate, beta, and universal-law models.
- **Predicting observations:** update model weights and parameter distributions, then predict single or joint future outcomes; includes averaging across two or three beta forecasters.
- **Bayes factors & odds:** reciprocal/transitive comparisons, posterior odds, fixed-versus-beta evidence, comparisons between beta forecasters, evidence for a general law, and conditional or combined evidence from two successive batches.
- **Exam practice:** five linked calculations: identify a source, predict, update with another observation, correct the order of the same observations, then predict several future observations jointly.

There is one practice stream per skill, with no difficulty or session-length choices. Each question has optional guided numerical steps, hints, a worked solution, and a course-book reference. Students can check an answer or reveal the solution after working on paper. “Another question” generates fresh numbers; exam practice moves through five linked parts and then offers a new scenario. These questions practise the skills assessed in the supplied course materials; they are not copies of the original assessment questions.

The streams also include central calculations from the assigned book chapters. General-law exercises distinguish the probability of a law from the probability of the next success, including unequal model priors and failures that rule out the stated error-free law. Sequential evidence exercises update parameter distributions between batches. Beta-forecaster exercises offer guided checks of every posterior model weight and within-model prediction before averaging. These additions use the existing seven cards and do not change the five-part exam scenario.

## Run locally

Use Node.js 20 or newer. There are no runtime packages to install and no build step.

```sh
npm run dev
npm test
```

Open [the local preview](http://127.0.0.1:4173/BayesianInferenceForPsychology/). `PORT` selects a different port. The server binds to the local computer, serves only `site/`, and supports the GitHub Pages project path.

For browser checks, start the preview and run `node tests/browser.mjs` with Playwright available. `BAYESVILLE_PLAYWRIGHT_MODULE` and `BAYESVILLE_CHROMIUM` can point to an existing installation. The browser checks cover direct-to-question practice, grading, guided steps, linked exams, no browser-storage access, and desktop/mobile layouts. Screenshots are written to the ignored `.artifacts/` directory.

`node tests/browser-audit.mjs` adds keyboard-only flows, accessible error descriptions, zoom-equivalent reflow, input contrast, and a sweep of all generated presentation types. It uses the same Playwright configuration. `node tests/browser-firefox-audit.mjs` runs a second-engine check in a temporary Firefox profile; it requires an installed Firefox with WebDriver BiDi and a Node runtime with global `WebSocket` support. Set `BAYESVILLE_FIREFOX` to override the Firefox binary path. These optional audits do not install browsers or use your normal browser profile.

## Publish on GitHub Pages

1. Commit the platform files and push to `main` in `hrgodmann/BayesianInferenceForPsychology`.
2. Under **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Run **Publish Bayesville** under Actions, or push a change to `main`.
4. Wait for a successful deployment at [hrgodmann.github.io/BayesianInferenceForPsychology/](https://hrgodmann.github.io/BayesianInferenceForPsychology/).

The workflow runs the unit tests and publishes only `site/`. It excludes the book, original assessments (including `2025/`), syllabus, and instructor notes. These source folders are also ignored by Git. Local edits alone do not update the published site.

## Calculations and generators

- `site/math.js` contains binomial/beta predictive probabilities, model updating, and model-averaged prediction. Posterior weights are normalized in log space. Joint predictions integrate a shared unknown rate, rather than substituting its mean.
- `site/questions.js` exports the skill catalog, `generateQuestion(skillId, seed)`, and `generateExam(seed)`. Each question includes a full-precision answer, units, display precision, numerical working steps, hints, and source metadata.
- `site/engine.js` handles numeric parsing, rounding, and grading.
- `site/app.js` renders the interface. All assets use relative paths; the site works under a GitHub Pages repository path.

Seeds make generated questions reproducible in tests. `tests/audit-math.test.js` independently reconstructs answers and intermediate steps using exact BigInt fractions and factorial beta integrals from the displayed inputs. It checks final rounding, fraction/decimal-comma/percentage acceptance, adjacent incorrect answers, and displayed working. Each skill and exam scenario is checked with consecutive seeds, seeds spread across the full 32-bit range, and integer-boundary seeds. Set `BAYESVILLE_AUDIT_SEEDS` to increase the default 2,500 seeds in each main sample. Add mathematical regression tests for new exercise families, including source-assessment benchmark calculations with independent expected results.

Answers accept decimals, decimal commas, fractions, and percentages for probabilities. Final answers are checked after rounding to the precision displayed, with exact halfway values rounded up. Probabilities close to zero or one use four decimal places, increasing to six or eight if necessary to avoid rounding a possible event to impossibility or an uncertain event to certainty. Intermediate calculations keep full precision; guided-step checks do not feed rounded values into later calculations.

## No saved progress

The app does not read or write local storage, session storage, cookies, or a backend. It holds only the current question (or linked exam scenario) in memory. Leaving practice or reloading discards the current inputs and scenario. There are no accounts, saved sessions, attempts, scores, bookmarks, or review lists. Storage from earlier versions is not read or reused.

The visual theme retains the supplied artwork in `site/assets/autumn-village.png`. `site/styles.css` and `site/autumn.css` provide the existing paper surfaces and typography; `site/calculations.css` adds the calculation workbook layout. Fonts come from the device, without external font requests.
