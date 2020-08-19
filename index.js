// const core = require("@actions/core");
// const github = require("@actions/github");
const { Octokit } = require("@octokit/action");

const AUTOMERGE = "automerge";

main();

async function main() {
  const octokit = Octokit();
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
          pullRequest.labels.map((label) => label.name).includes(AUTOMERGE)
        )
        .map((pullRequest) => {
          return {
            number: pullRequest.number,
            html_url: pullRequest.html_url,
            ref: pullRequest.head.sha,
          };
        });
    }
  );

  if (pullRequests.length === 0) {
    return;
  }

  pullRequests.forEach(async (pullRequest) => {
    const comparison = await octokit.request(
      "GET /repos/:owner/:repo/compare/:base...:head",
      {
        owner,
        repo,
        base: pullRequest.head.label,
        head: pullRequest.base.label,
      },
      (response) => response.data
    );

    if (comparison.behind_by > 0) {
      await octokit.request("POST /repos/:owner/:repo/merges", {
        owner,
        repo,
        base: pullRequest.head.label,
        head: pullRequest.base.label,
      });
    } else {
      await octokit.request("POST /repos/:owner/:repo/merges", {
        owner,
        repo,
        base: pullRequest.base.label,
        head: pullRequest.head.label,
      });
    }
  });
}
