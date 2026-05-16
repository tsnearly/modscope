import type { RedisClient } from '@devvit/web/server';
import {
  ConfigSettings,
  CalculationSettings,
  DEFAULT_CALCULATION_SETTINGS,
} from '../../shared/types/settings';
import { redisKey } from '../../shared/core/constants';

export class ConfigService {

  constructor(private redis: RedisClient) {}

  async getConfig(): Promise<ConfigSettings> {
    const configStr = await this.redis.get(redisKey.appConfig);
    if (configStr) {
      return JSON.parse(configStr);
    }
    return { settings: DEFAULT_CALCULATION_SETTINGS, lastUpdated: Date.now() };
  }

  async updateConfig(
    newConfig: Partial<ConfigSettings>
  ): Promise<ConfigSettings> {
    const currentConfig = await this.getConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    await this.redis.set(redisKey.appConfig, JSON.stringify(updatedConfig));
    return updatedConfig;
  }

  async updateCalculationSettings(
    newSettings: Partial<CalculationSettings>
  ): Promise<ConfigSettings> {
    const currentConfig = await this.getConfig();
    const updatedConfig: ConfigSettings = {
      ...currentConfig,
      settings: { ...currentConfig.settings, ...newSettings },
      lastUpdated: Date.now(),
    };
    await this.redis.set(redisKey.appConfig, JSON.stringify(updatedConfig));
    return updatedConfig;
  }
}
