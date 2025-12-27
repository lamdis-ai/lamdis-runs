import { describe, it, expect } from 'vitest';
import { getAtPath, interpolateString, interpolateDeep } from './interpolation.js';

describe('interpolation', () => {
  describe('getAtPath', () => {
    const obj = {
      user: {
        name: 'Alice',
        email: 'alice@example.com',
        addresses: [
          { city: 'NYC', zip: '10001' },
          { city: 'LA', zip: '90001' },
        ],
      },
      items: ['a', 'b', 'c'],
      count: 42,
      active: true,
    };

    it('returns undefined for empty path', () => {
      // Implementation returns undefined for empty path
      expect(getAtPath(obj, '')).toBeUndefined();
    });

    it('returns undefined for null path', () => {
      expect(getAtPath(obj, null as any)).toBeUndefined();
    });

    it('accesses simple property', () => {
      expect(getAtPath(obj, 'count')).toBe(42);
      expect(getAtPath(obj, 'active')).toBe(true);
    });

    it('accesses nested property with dot notation', () => {
      expect(getAtPath(obj, 'user.name')).toBe('Alice');
      expect(getAtPath(obj, 'user.email')).toBe('alice@example.com');
    });

    it('handles $. prefix (JSONPath-like)', () => {
      expect(getAtPath(obj, '$.user.name')).toBe('Alice');
      expect(getAtPath(obj, '$user.name')).toBe('Alice');
    });

    it('accesses array elements with bracket notation', () => {
      expect(getAtPath(obj, 'items[0]')).toBe('a');
      expect(getAtPath(obj, 'items[1]')).toBe('b');
      expect(getAtPath(obj, 'items[2]')).toBe('c');
    });

    it('accesses nested object within array', () => {
      expect(getAtPath(obj, 'user.addresses[0].city')).toBe('NYC');
      expect(getAtPath(obj, 'user.addresses[1].zip')).toBe('90001');
    });

    it('returns undefined for non-existent path', () => {
      expect(getAtPath(obj, 'nonexistent')).toBeUndefined();
      expect(getAtPath(obj, 'user.nonexistent')).toBeUndefined();
      expect(getAtPath(obj, 'user.addresses[5]')).toBeUndefined();
    });

    it('returns undefined when accessing array index on non-array', () => {
      expect(getAtPath(obj, 'count[0]')).toBeUndefined();
    });

    it('returns undefined for null/undefined objects', () => {
      expect(getAtPath(null, 'any.path')).toBeUndefined();
      expect(getAtPath(undefined, 'any.path')).toBeUndefined();
    });

    it('handles mixed bracket and dot notation', () => {
      expect(getAtPath(obj, 'user.addresses[0].city')).toBe('NYC');
    });
  });

  describe('interpolateString', () => {
    const vars = {
      user: { name: 'Bob', age: 30 },
      env: { HOST: 'localhost', PORT: '3000' },
    };

    it('returns null/undefined unchanged', () => {
      expect(interpolateString(null, vars)).toBeNull();
      expect(interpolateString(undefined, vars)).toBeUndefined();
    });

    it('returns non-string values unchanged', () => {
      expect(interpolateString(42, vars)).toBe(42);
      expect(interpolateString(true, vars)).toBe(true);
      expect(interpolateString({ a: 1 }, vars)).toEqual({ a: 1 });
    });

    it('returns string without placeholders unchanged', () => {
      expect(interpolateString('hello world', vars)).toBe('hello world');
    });

    it('interpolates simple placeholder', () => {
      expect(interpolateString('Hello ${user.name}!', vars)).toBe('Hello Bob!');
    });

    it('interpolates multiple placeholders', () => {
      expect(interpolateString('${user.name} is ${user.age} years old', vars)).toBe('Bob is 30 years old');
    });

    it('interpolates nested paths', () => {
      expect(interpolateString('Connect to ${env.HOST}:${env.PORT}', vars)).toBe('Connect to localhost:3000');
    });

    it('replaces non-existent paths with empty string', () => {
      expect(interpolateString('Value: ${nonexistent}', vars)).toBe('Value: ');
    });

    it('leaves empty placeholder expression unchanged', () => {
      // Implementation regex requires non-empty expression: /\$\{([^}]+)\}/
      expect(interpolateString('Value: ${}', vars)).toBe('Value: ${}');
    });
  });

  describe('interpolateDeep', () => {
    const vars = {
      name: 'TestUser',
      id: 123,
      config: { timeout: 5000 },
    };

    it('returns null/undefined unchanged', () => {
      expect(interpolateDeep(null, vars)).toBeNull();
      expect(interpolateDeep(undefined, vars)).toBeUndefined();
    });

    it('interpolates string values', () => {
      expect(interpolateDeep('Hello ${name}', vars)).toBe('Hello TestUser');
    });

    it('interpolates array elements', () => {
      const arr = ['${name}', '${id}', 'static'];
      expect(interpolateDeep(arr, vars)).toEqual(['TestUser', '123', 'static']);
    });

    it('interpolates object values recursively', () => {
      const input = {
        greeting: 'Hello ${name}',
        meta: {
          userId: '${id}',
          timeout: '${config.timeout}',
        },
      };
      expect(interpolateDeep(input, vars)).toEqual({
        greeting: 'Hello TestUser',
        meta: {
          userId: '123',
          timeout: '5000',
        },
      });
    });

    it('preserves non-string primitive values', () => {
      const input = { str: '${name}', num: 42, bool: true };
      expect(interpolateDeep(input, vars)).toEqual({
        str: 'TestUser',
        num: 42,
        bool: true,
      });
    });

    it('handles deeply nested structures', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              value: '${name}-${id}',
            },
          },
        },
      };
      expect(interpolateDeep(input, vars)).toEqual({
        level1: {
          level2: {
            level3: {
              value: 'TestUser-123',
            },
          },
        },
      });
    });

    it('handles arrays within objects', () => {
      const input = {
        users: ['${name}'],
        nested: { items: ['${id}', 'static'] },
      };
      expect(interpolateDeep(input, vars)).toEqual({
        users: ['TestUser'],
        nested: { items: ['123', 'static'] },
      });
    });
  });
});
