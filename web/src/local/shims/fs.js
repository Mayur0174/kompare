// Minimal node:fs stand-in for the on-device build (the server never touches files there).
const fs = { existsSync: () => false, mkdirSync() {}, rmSync() {} };
export default fs;
