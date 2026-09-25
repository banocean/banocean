const GITHUB_USERNAME = "banocean";
const GITLAB_USERNAME = "banocean";

const getDayKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

const formatDateHeader = (date) => date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const formatShortDate = (date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const escapeHtml = (str = "") => {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#039;");
}

const fetchOpts = { headers: { "User-Agent": "Vite-Activity-Plugin" } };

const fetchGitHubEvents = async (username) => {
    try {
        const res = await fetch(`https://api.github.com/users/${username}/events/public?per_page=100`, fetchOpts);
        return res.ok ? await res.json() : [];
    } catch { return []; }
}

const fetchGitLabEvents = async (username) => {
    try {
        const res = await fetch(`https://gitlab.com/api/v4/users/${username}/events?per_page=100`, fetchOpts);
        return res.ok ? await res.json() : [];
    } catch { return []; }
}

const gitlabProjectCache = new Map();
const getGitlabProject = async (projectId) => {
    if (gitlabProjectCache.has(projectId)) return gitlabProjectCache.get(projectId);
    try {
        const res = await fetch(`https://gitlab.com/api/v4/projects/${projectId}`, fetchOpts);
        if (res.ok) {
            const data = await res.json();
            const info = { name: data.path_with_namespace, url: data.web_url };
            gitlabProjectCache.set(projectId, info);
            return info;
        }
    } catch {}
    return { name: `Project #${projectId}`, url: "https://gitlab.com" };
}

const githubPrCache = new Map();
const getGithubPrTitle = async (repoName, prNumber) => {
    const key = `${repoName}#${prNumber}`;
    if (githubPrCache.has(key)) return githubPrCache.get(key);
    try {
        const res = await fetch(`https://api.github.com/repos/${repoName}/pulls/${prNumber}`, fetchOpts);
        if (res.ok) {
            const data = await res.json();
            githubPrCache.set(key, data.title);
            return data.title;
        }
    } catch {}
    return null;
}

const processEvents = async (githubEvents, gitlabEvents) => {
    const events = [];

    for (const event of githubEvents) {
        const date = new Date(event.created_at);
        const repoName = event.repo?.name || "unknown";
        const repoUrl = `https://github.com/${repoName}`;

        if (event.type === "PushEvent") {
            const branch = (event.payload?.ref || "").replace("refs/heads/", "");
            if (branch === "main" || branch === "master") {
                events.push({
                    type: "commit", date, repoName, repoUrl,
                    count: event.payload?.commits?.length || event.payload?.size || 1
                });
            }
        } else if (event.type === "PullRequestEvent") {
            const pr = event.payload?.pull_request || {};
            events.push({
                type: "pr", date, repoName, repoUrl, platform: "github",
                prNumber: pr.number || event.payload?.number,
                title: pr.title,
                url: pr.html_url || `${repoUrl}/pull/${pr.number || event.payload?.number}`,
                action: event.payload?.action,
                merged: pr.merged || event.payload?.action === "merged"
            });
        } else if (event.type === "IssuesEvent") {
            const issue = event.payload?.issue || {};
            if (issue.pull_request) {
                events.push({
                    type: "pr", date, repoName, repoUrl, platform: "github",
                    prNumber: issue.number || event.payload?.number,
                    title: issue.title,
                    url: issue.html_url || `${repoUrl}/pull/${issue.number}`,
                    action: event.payload?.action,
                    merged: false
                });
            } else {
                events.push({
                    type: "issue", date, repoName, repoUrl,
                    issueNumber: issue.number || event.payload?.number,
                    title: issue.title || `Issue #${issue.number || ""}`,
                    url: issue.html_url || `${repoUrl}/issues/${issue.number}`,
                    action: event.payload?.action
                });
            }
        } else if (event.type === "PullRequestReviewEvent" || event.type === "PullRequestReviewCommentEvent" || (event.type === "IssueCommentEvent" && event.payload?.issue?.pull_request)) {
            events.push({ type: "review", date, repoName, repoUrl });
        } else if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
            events.push({ type: "create_repo", date, repoName, repoUrl });
        }
    }

    for (const event of gitlabEvents) {
        const date = new Date(event.created_at);
        const projectId = event.project_id;
        const repoName = `gitlab-${projectId}`;
        const repoUrl = `https://gitlab.com`;

        if (event.action_name?.includes("pushed")) {
            const branch = event.push_data?.ref || "";
            if (branch === "main" || branch === "master") {
                events.push({
                    type: "commit", date, repoName, repoUrl, projectId, platform: "gitlab",
                    count: event.push_data?.commit_count || 1
                });
            }
        } else if (event.target_type === "MergeRequest") {
            events.push({
                type: "pr", date, repoName, repoUrl, platform: "gitlab", projectId,
                prNumber: event.target_iid,
                title: event.target_title,
                action: event.action_name,
                merged: event.action_name === "accepted"
            });
        } else if (event.action_name?.includes("created project")) {
            events.push({ type: "create_repo", date, repoName, repoUrl, projectId, platform: "gitlab" });
        } else if (event.action_name?.includes("commented on")) {
            events.push({ type: "review", date, repoName, repoUrl, projectId, platform: "gitlab" });
        }
    }

    for (const event of events) {
        if (event.platform === "gitlab" && event.projectId) {
            const projectInfo = await getGitlabProject(event.projectId);
            event.repoName = projectInfo.name;
            event.repoUrl = projectInfo.url;
            if (event.type === "pr") event.url = `${projectInfo.url}/-/merge_requests/${event.prNumber}`;
        }

        if (event.type === "pr" && !event.title && event.prNumber) {
            if (event.platform === "github") {
                const realTitle = await getGithubPrTitle(event.repoName, event.prNumber);
                event.title = realTitle || `Pull Request #${event.prNumber}`;
            } else {
                event.title = `Pull Request #${event.prNumber}`;
            }
        }
    }

    return events;
}

const groupEventsByDay = (events) => {
    const daysMap = new Map();

    for (const event of events) {
        const dayKey = getDayKey(event.date);
        if (!daysMap.has(dayKey)) {
            daysMap.set(dayKey, {
                date: event.date,
                commits: new Map(),
                repos: new Map(),
                prs: new Map(),
                reviews: new Map(),
                issues: new Map()
            });
        }

        const day = daysMap.get(dayKey);

        if (event.type === "commit") {
            const current = day.commits.get(event.repoName) || { repoName: event.repoName, url: event.repoUrl, count: 0 };
            current.count += event.count;
            day.commits.set(event.repoName, current);
        } else if (event.type === "create_repo") {
            day.repos.set(event.repoName, event);
        } else if (event.type === "pr") {
            if (!day.prs.has(event.repoName)) day.prs.set(event.repoName, new Map());
            const repoPrs = day.prs.get(event.repoName);
            const prId = event.prNumber ? String(event.prNumber) : event.title;

            const existing = repoPrs.get(prId) || { title: event.title, url: event.url, date: event.date, status: "open" };

            let newStatus = "open";
            if (event.merged) newStatus = "merged";
            else if (event.action === "closed") newStatus = "closed";

            if (newStatus === "merged") existing.status = "merged";
            else if (newStatus === "closed" && existing.status !== "merged") existing.status = "closed";

            repoPrs.set(prId, existing);
        } else if (event.type === "review") {
            const current = day.reviews.get(event.repoName) || { url: event.repoUrl, count: 0 };
            current.count += 1;
            day.reviews.set(event.repoName, current);
        } else if (event.type === "issue") {
            if (!day.issues.has(event.repoName)) day.issues.set(event.repoName, new Map());
            const repoIssues = day.issues.get(event.repoName);
            const issueId = event.issueNumber ? String(event.issueNumber) : event.title;

            const existing = repoIssues.get(issueId) || { title: event.title, url: event.url, date: event.date, status: "open" };
            if (event.action === "closed") existing.status = "closed";
            repoIssues.set(issueId, existing);
        }
    }

    return Array.from(daysMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
}

const renderActivityHtml = (days) => {
    if (days.length === 0) return `<div class="activity-feed">No recent activity found.</div>`;

    const daysHtml = days.map((day) => {
        const blocks = [];

        if (day.commits.size > 0) {
            const commitList = Array.from(day.commits.values());
            const totalCommits = commitList.reduce((acc, c) => acc + c.count, 0);
            const uniqueRepos = commitList.length;
            const maxCount = Math.max(...commitList.map((c) => c.count));

            const rows = commitList.map((c) => {
                const barWidth = Math.max(12, Math.round((c.count / maxCount) * 100));
                return `
                    <div class="activity-row">
                        <div class="activity-row-left">
                            <a href="${c.url}" target="_blank" class="activity-link">${escapeHtml(c.repoName)}</a>
                            <span class="activity-subtext">${c.count} ${c.count === 1 ? "commit" : "commits"}</span>
                        </div>
                        <div class="activity-bar-bg"><div class="activity-bar-fill" style="width: ${barWidth}%;"></div></div>
                    </div>`;
            }).join("");

            blocks.push(`
                <div class="activity-item">
                    <div class="activity-badge"><i class="fa-solid fa-code-commit"></i></div>
                        <div class="activity-content">
                            <div class="activity-title">Created ${totalCommits} ${totalCommits === 1 ? "commit" : "commits"} in ${uniqueRepos} ${uniqueRepos === 1 ? "repository" : "repositories"}</div>
                            <div class="activity-list">${rows}</div>
                        </div>
                    </div>`
            );
        }

        if (day.repos.size > 0) {
            const rows = Array.from(day.repos.values()).map((r) => `
                <div class="activity-row">
                    <div class="activity-row-left">
                        <i class="fa-solid fa-book-bookmark activity-subicon"></i>
                        <a href="${r.repoUrl}" target="_blank" class="activity-link">${escapeHtml(r.repoName)}</a>
                    </div>
                    <span class="activity-date">${formatShortDate(r.date)}</span>
                </div>`
            ).join("");

            blocks.push(`
                <div class="activity-item">
                    <div class="activity-badge"><i class="fa-solid fa-book-bookmark"></i></div>
                    <div class="activity-content">
                        <div class="activity-title">Created ${day.repos.size} ${day.repos.size === 1 ? "repository" : "repositories"}</div>
                        <div class="activity-list">${rows}</div>
                    </div>
                </div>`
            );
        }

        if (day.prs.size > 0) {
            let totalPrs = 0;
            const repoBlocks = Array.from(day.prs.entries()).map(([repoName, prMap]) => {
                const prList = Array.from(prMap.values());
                totalPrs += prList.length;

                const openCount = prList.filter((p) => p.status === "open").length;
                const closedCount = prList.filter((p) => p.status === "closed").length;
                const mergedCount = prList.filter((p) => p.status === "merged").length;

                let pillsHtml = "";
                if (openCount) pillsHtml += `<span class="activity-pill open"><span class="activity-pill-num">${openCount}</span> open</span>`;
                if (closedCount) pillsHtml += `<span class="activity-pill closed"><span class="activity-pill-num">${closedCount}</span> closed</span>`;
                if (mergedCount) pillsHtml += `<span class="activity-pill merged"><span class="activity-pill-num">${mergedCount}</span> merged</span>`;

                const rows = prList.map((pr) => {
                    let icon = "fa-solid fa-code-pull-request pr-open";
                    if (pr.status === "merged") icon = "fa-solid fa-code-merge pr-merged";
                    else if (pr.status === "closed") icon = "fa-solid fa-code-pull-request pr-closed";

                    return `
                        <div class="activity-row nested">
                            <div class="activity-row-left">
                                <i class="${icon}"></i>
                                <a href="${pr.url}" target="_blank" class="activity-pr-title">${escapeHtml(pr.title)}</a>
                            </div>
                            <span class="activity-date">${formatShortDate(pr.date)}</span>
                        </div>`;
                }).join("");

                return `
                    <div class="activity-repo-group">
                        <div class="activity-repo-subheading">
                            <a href="https://github.com/${repoName}" target="_blank" class="activity-repo-sublink">${escapeHtml(repoName)}</a>
                            <div class="activity-status-pills">${pillsHtml}</div>
                        </div>
                        <div class="activity-list">${rows}</div>
                    </div>`;
            }).join("");

            blocks.push(`
                <div class="activity-item">
                    <div class="activity-badge"><i class="fa-solid fa-code-pull-request"></i></div>
                    <div class="activity-content">
                        <div class="activity-title">Opened ${totalPrs} pull ${totalPrs === 1 ? "request" : "requests"} in ${day.prs.size} ${day.prs.size === 1 ? "repository" : "repositories"}</div>
                        ${repoBlocks}
                    </div>
                </div>`);
        }

        if (day.reviews.size > 0) {
            const reviewList = Array.from(day.reviews.entries());
            const totalReviews = reviewList.reduce((acc, [, data]) => acc + data.count, 0);

            const rows = reviewList.map(([repoName, data]) => `
                <div class="activity-row">
                    <div class="activity-row-left">
                        <a href="${data.url}" target="_blank" class="activity-link">${escapeHtml(repoName)}</a>
                    </div>
                    <span class="activity-subtext-right">${data.count} pull ${data.count === 1 ? "request" : "requests"}</span>
                </div>`
            ).join("");

            blocks.push(`
                <div class="activity-item">
                    <div class="activity-badge"><i class="fa-regular fa-eye"></i></div>
                    <div class="activity-content">
                        <div class="activity-title">Reviewed ${totalReviews} pull ${totalReviews === 1 ? "request" : "requests"} in ${day.reviews.size} ${day.reviews.size === 1 ? "repository" : "repositories"}</div>
                        <div class="activity-list">${rows}</div>
                    </div>
                </div>`
            );
        }

        if (day.issues.size > 0) {
            let totalIssues = 0;
            const repoBlocks = Array.from(day.issues.entries()).map(([repoName, issueMap]) => {
                const issues = Array.from(issueMap.values());
                totalIssues += issues.length;

                const rows = issues.map((issue) => `
                    <div class="activity-row nested">
                        <div class="activity-row-left">
                            <i class="fa-regular fa-circle-dot issue-open"></i>
                            <a href="${issue.url}" target="_blank" class="activity-pr-title">${escapeHtml(issue.title)}</a>
                        </div>
                        <span class="activity-date">${formatShortDate(issue.date)}</span>
                    </div>`
                ).join("");

                return `
                    <div class="activity-repo-group">
                        <div class="activity-repo-subheading">
                            <a href="https://github.com/${repoName}" target="_blank" class="activity-repo-sublink">${escapeHtml(repoName)}</a>
                        </div>
                        <div class="activity-list">${rows}</div>
                    </div>`;
            }).join("");

            blocks.push(`
                <div class="activity-item">
                    <div class="activity-badge"><i class="fa-regular fa-circle-dot"></i></div>
                    <div class="activity-content">
                        <div class="activity-title">Opened ${totalIssues} ${totalIssues === 1 ? "issue" : "issues"} in ${day.issues.size} ${day.issues.size === 1 ? "repository" : "repositories"}</div>
                        ${repoBlocks}
                    </div>
                </div>`
            );
        }

        if (blocks.length === 0) return "";

        return `
            <div class="activity-day-group">
                <div class="activity-day-header">
                    <span class="activity-day-label">${formatDateHeader(day.date)}</span>
                    <div class="activity-day-divider"></div>
                </div>
                <div class="activity-day-timeline">
                    ${blocks.join("")}
                </div>
            </div>`;
    }).join("");

    return `<div class="activity-feed">${daysHtml}</div>`;
}

let pregeneratedHtmlPromise = null;

export function activityPlugin() {
    async function generate() {
        const [gh, gl] = await Promise.all([
            fetchGitHubEvents(GITHUB_USERNAME),
            fetchGitLabEvents(GITLAB_USERNAME),
        ]);
        const normalized = await processEvents(gh, gl);
        const days = groupEventsByDay(normalized);
        return renderActivityHtml(days);
    }

    return {
        name: "vite-plugin-activity",

        buildStart() {
            if (!pregeneratedHtmlPromise) {
                console.log("\x1b[36m[activity-plugin]\x1b[0m Pre-fetching GitHub & GitLab activity...");
                pregeneratedHtmlPromise = generate()
                    .then(html => {
                        console.log("\x1b[32m[activity-plugin]\x1b[0m Activity successfully pre-generated.");
                        return html;
                    })
                    .catch(err => {
                        console.error("\x1b[31m[activity-plugin]\x1b[0m Failed to generate activity:", err);
                        return `<div style="color:red">Failed to load activity</div>`;
                    });
            }
        },

        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (req.url === "/activity.html") {
                    const html = await pregeneratedHtmlPromise;
                    res.setHeader("Content-Type", "text/html; charset=utf-8");
                    res.end(html);
                    return;
                }
                next();
            });
        },

        async generateBundle() {
            const html = await pregeneratedHtmlPromise;
            this.emitFile({ type: "asset", fileName: "activity.html", source: html });
        },
    };
}
