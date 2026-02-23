declare namespace Cloudflare {
  interface Env {
    LINEAR_WEBHOOK_SIGNING_SECRET: string;
    LINEAR_ACCESS_TOKEN: string;
    LINEAR_AGENT: DurableObjectNamespace;
  }
}
interface Env extends Cloudflare.Env {}
