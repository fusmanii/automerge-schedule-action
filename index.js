const core = require("@actions/core");
const { Octokit } = require("@octokit/action");

const AUTOMERGE = "automerge";
const KEEPITFRESH = "keepitfresh";

main();

async function main() {
  const sleep = (timeMs) => {
    return new Promise((resolve) => {
      setTimeout(resolve, timeMs);
    });
  };
  const octokit = new Octokit();
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  const pullRequests = await octokit.paginate(
    "GET /repos/:owner/:repo/pulls",
    {
      owner,
      repo,
      state: "open",
    },
    (response) => {
      return response.data
        .filter((pullRequest) =>
          [AUTOMERGE, KEEPITFRESH].some((label) =>
            pullRequest.labels.map((label) => label.name).includes(label)
          )
        )
        .map((pullRequest) => {
          return {
            number: pullRequest.number,
            html_url: pullRequest.html_url,
            ref: pullRequest.head.sha,
            head: pullRequest.head,
            base: pullRequest.base,
            labels: pullRequest.labels,
          };
        })
        .sort((first, second) =>
          first.number > second.number
            ? 1
            : second.number > first.number
            ? -1
            : 0
        );
    }
  );

  if (pullRequests.length === 0) {
    return;
  }

  let mergedPullRequest;
  let comparisonByPullRequest = {};
  for (pullRequest of pullRequests) {
    const comparison = await octokit
      .request("GET /repos/:owner/:repo/compare/:base...:head", {
        owner,
        repo,
        base: pullRequest.base.label,
        head: pullRequest.head.label,
      })
      .then((response) => response.data);

    core.info(
      `Comparison ${pullRequest.head.label} behind by ${JSON.stringify(
        comparison.behind_by
      )}`
    );
    comparisonByPullRequest[pullRequest.number] = comparison.behind_by;
    if (
      comparison.behind_by === 0 &&
      pullRequest.labels.map((label) => label.name).includes(AUTOMERGE)
    ) {
      core.info(
        `Attempting to merge ${pullRequest.head.ref} into ${pullRequest.base.ref}`
      );
      await octokit
        .request("PUT /repos/:owner/:repo/pulls/:pull_number/merge", {
          owner,
          repo,
          pull_number: pullRequest.number,
          merge_method: "squash",
        })
        .then(() => {
          mergedPullRequest = pullRequest;
        })
        .catch(() => {});
    }
  }

  pullRequests.forEach(async (pullRequest) => {
    core.info(`compt ${JSON.stringify(comparisonByPullRequest)}`);
    core.info(`mergedPullRequest ${JSON.stringify(mergedPullRequest)}`);
    if (comparisonByPullRequest[pullRequest.number] > 0 || mergedPullRequest) {
      core.info(
        `Attempting to merged ${pullRequest.base.ref} into ${pullRequest.head.ref}`
      );
      try {
        await octokit.request("POST /repos/:owner/:repo/merges", {
          owner,
          repo,
          base: pullRequest.head.ref,
          head: pullRequest.base.ref,
        });
      } catch (err) {
        if (err.message === "Merge conflict") {
          await octokit.request(
            "POST /repos/:owner/:repo/issues/:issue_number/comments",
            {
              owner,
              repo,
              issue_number: pullRequest.number,
              body: "Conflict with base branch 💩",
            }
          );
        }
      }
    }
    await sleep(2000);
  });
}
