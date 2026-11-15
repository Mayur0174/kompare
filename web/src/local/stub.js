// Web builds talk to the HTTP API; the on-device backend is only bundled in the mobile build.
export async function localApi() { throw new Error('On-device backend is not part of this build'); }
