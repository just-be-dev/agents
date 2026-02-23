export interface ManifestOptions {
  webhookUrl: string;
  redirectUrl: string;
  org?: string;
}

export function buildManifest(options: ManifestOptions) {
  return {
    url: "https://github.com/apps/replace-me",
    hook_attributes: {
      url: `${options.webhookUrl}/github`,
      active: true,
    },
    redirect_url: options.redirectUrl,
    public: false,
    default_permissions: {
      issues: "write",
      pull_requests: "write",
      contents: "read",
      metadata: "read",
    },
    default_events: [
      "issues",
      "pull_request",
      "push",
    ],
  };
}

export function getManifestFormUrl(org?: string): string {
  if (org) {
    return `https://github.com/organizations/${org}/settings/apps/new`;
  }
  return "https://github.com/settings/apps/new";
}
