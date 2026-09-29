# Bayesville

A friendly practice platform for Bayesian inference students. Choose a chapter, practise true/false or calculation questions, ask for hints, and review short worked explanations.

The initial question bank covers six reading sections: the Synopsis and chapters 1, 2, 3, 5, and 6. Its questions adapt the topics and reasoning in quizzes 1–2, with changed examples, wording, and numerical values. This is a starting practice bank, not a complete textbook assessment.

## Run locally

Use Node.js 20 or newer. There are no packages to install and no build step.

```sh
npm run dev
```

Open [the local preview](http://127.0.0.1:4173/BayesianInferenceForPsychology/). The server also supports the root URL. It serves only `site/`, uses the same project path as GitHub Pages, and binds to your own computer. Set `PORT` to choose a different port.

```sh
npm test
```

The tests check the question schema, calculation answers, grading, and saved progress. The deployment workflow runs them before publishing. For optional browser checks, start the preview server and run `node tests/browser.mjs` with Playwright available; `BAYESVILLE_PLAYWRIGHT_MODULE` and `BAYESVILLE_CHROMIUM` can point to an existing installation. Browser checks cover the full practice journey, keyboard navigation, and desktop/mobile layouts.

## Publish on GitHub Pages

1. Commit the platform files and push them to `main` in `hrgodmann/BayesianInferenceForPsychology`.
2. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Under **Actions**, run **Publish Bayesville**, or push another change to `main`.
4. Wait for the deployment to succeed. The workflow's environment link shows the published URL.

The expected address is [hrgodmann.github.io/BayesianInferenceForPsychology/](https://hrgodmann.github.io/BayesianInferenceForPsychology/). Adding these files locally does not make that address live; GitHub must complete the deployment first.

The workflow in `.github/workflows/pages.yml` publishes **only `site/`**. It does not publish the book, original quizzes, syllabus, or working notes as part of the website. A public GitHub repository exposes files committed to that repository, so select the files for the initial commit deliberately. The workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Add or edit practice content

The browser loads the question bank from `site/questions.js`. Keep question IDs stable so existing progress still refers to the right question. Each question belongs to a chapter and question type, with its answer, hint, and explanation stored alongside the prompt. Copy a nearby example of the same type when adding a question, then run the tests and check the result in the browser.

The site uses plain HTML, CSS, and JavaScript modules. Keep asset links relative so they work beneath the repository path on GitHub Pages. Publishable assets belong inside `site/`.

## Student progress

Progress is saved in browser storage on the current device. There are no accounts, backend, class roster, or instructor dashboard. Progress does not synchronise across browsers or devices, and clearing browser data removes it. Answers are included in the public question bank because this is a practice tool, not a secure exam platform.
