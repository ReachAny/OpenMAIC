import { createLaunchGrantManager } from './launch';
import { getOpenMaicRedisStore } from './redis';
import { createOpenMaicSessionManager } from './session';

export function getOpenMaicBridgeRuntime() {
  const redis = getOpenMaicRedisStore();
  return {
    redis,
    launches: createLaunchGrantManager(redis),
    sessions: createOpenMaicSessionManager(redis),
  };
}
