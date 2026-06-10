import { describe, it, expect } from 'vitest';
import { getServiceDefinition, getAllServices, getServicesByType } from '../icons/services.js';

describe('Service Registry', () => {
  it('returns service definition for known services', () => {
    const api = getServiceDefinition('api');
    expect(api).toBeDefined();
    expect(api?.name).toBeDefined();
    expect(api?.icon).toBeDefined();
    expect(api?.type).toBeDefined();
  });

  it('resolves service aliases', () => {
    const claude = getServiceDefinition('claude');
    expect(claude).toBeDefined();
    expect(claude?.name).toContain('Anthropic');
    expect(claude?.type).toBe('ai');
  });

  it('returns same definition for multiple aliases', () => {
    const openai1 = getServiceDefinition('openai');
    const openai2 = getServiceDefinition('gpt-4');
    expect(openai1?.name).toBe(openai2?.name);
  });

  it('returns definition even for unknown services', () => {
    const unknown = getServiceDefinition('unknown-xyz-service-12345');
    // getServiceDefinition always returns a definition (creates fallback service)
    expect(unknown).toBeDefined();
  });

  it('returns service with type ai', () => {
    const anthropic = getServiceDefinition('anthropic');
    expect(anthropic?.type).toBe('ai');
  });

  it('returns service with type database', () => {
    const postgres = getServiceDefinition('postgresql');
    expect(postgres?.type).toBe('database');
  });

  it('returns service with type cache', () => {
    const redis = getServiceDefinition('redis');
    expect(redis?.type).toBe('cache');
  });

  it('returns service with type messaging', () => {
    const kafka = getServiceDefinition('kafka');
    expect(kafka?.type).toBe('messaging');
  });

  it('returns service with type storage', () => {
    const s3 = getServiceDefinition('s3');
    expect(s3?.type).toBe('storage');
  });

  it('has proper color for services', () => {
    const service = getServiceDefinition('api');
    expect(service?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has proper backgroundColor for services', () => {
    const service = getServiceDefinition('api');
    expect(service?.backgroundColor).toBeDefined();
  });

  it('handles case-insensitive lookups', () => {
    const lower = getServiceDefinition('postgresql');
    const upper = getServiceDefinition('PostgreSQL');
    const mixed = getServiceDefinition('PostgreSql');
    expect(lower?.name).toBe(upper?.name);
    expect(lower?.name).toBe(mixed?.name);
  });

  it('handles service names with spaces', () => {
    const def = getServiceDefinition('google cloud');
    expect(def).toBeDefined();
  });

  it('has consistent service definitions', () => {
    const services = ['api', 'postgresql', 'redis', 'kafka', 'openai'];
    for (const serviceName of services) {
      const def = getServiceDefinition(serviceName);
      expect(def?.name).toBeDefined();
      expect(def?.icon).toBeDefined();
      expect(def?.color).toBeDefined();
      expect(def?.backgroundColor).toBeDefined();
      expect(def?.type).toBeDefined();
    }
  });

  it('provides getAllServices utility', () => {
    const allServices = getAllServices();
    expect(allServices.length).toBeGreaterThan(0);
    expect(allServices[0]).toHaveProperty('name');
    expect(allServices[0]).toHaveProperty('type');
  });

  it('filters services by type', () => {
    const aiServices = getServicesByType('ai');
    expect(aiServices.length).toBeGreaterThan(0);
    for (const service of aiServices) {
      expect(service.type).toBe('ai');
    }
  });
});
