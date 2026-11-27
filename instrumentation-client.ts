// Runs in the browser before the app's own code and before hydration (Next's instrumentation-client).
//
// S2 (review 2026-10-20, docs/drift/CSP.md): zod 4 builds fast parsers with `new Function` and tries it once when the
// first object schema is made. The nonce-based Content-Security-Policy has no 'unsafe-eval', so that try is reported (and
// blocked once CSP_ENFORCE=true). jitless turns the attempt off in the browser; the parsers are the same, only a little
// slower, and the server keeps its fast path.
import { config } from "zod";

config({ jitless: true });
