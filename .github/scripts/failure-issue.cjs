/**
 * Keeps one GitHub issue per failing check: opened (or commented on) when a
 * scheduled check fails, closed when it passes again. GitHub emails the repo
 * owner on new issues and comments, so a red night never goes unnoticed.
 *
 * Used from actions/github-script:
 *   await require('./.github/scripts/failure-issue.cjs')({ github, context, failed: true, title: "Nightly checks failing" })
 */
module.exports = async ({ github, context, failed, title, body = "" }) => {
  const { owner, repo } = context.repo;
  const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const label = "automated-check";
  try {
    await github.rest.issues.createLabel({ owner, repo, name: label, color: "d73a4a", description: "Opened by a scheduled check" });
  } catch {
    // already there
  }
  const { data: open } = await github.rest.issues.listForRepo({ owner, repo, state: "open", labels: label, per_page: 100 });
  const existing = open.find((i) => i.title === title);
  if (failed) {
    const text = `${body}\n\nRun: ${run}\nCommit: ${context.sha.slice(0, 7)}`.trim();
    if (existing) await github.rest.issues.createComment({ owner, repo, issue_number: existing.number, body: `Still failing.\n\n${text}` });
    else await github.rest.issues.create({ owner, repo, title, labels: [label], body: `This check failed.\n\n${text}\n\nThis issue closes by itself when the check passes again.` });
  } else if (existing) {
    await github.rest.issues.createComment({ owner, repo, issue_number: existing.number, body: `Passing again: ${run}` });
    await github.rest.issues.update({ owner, repo, issue_number: existing.number, state: "closed" });
  }
};
