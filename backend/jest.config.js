module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@aerocab/shared$': '<rootDir>/../packages/shared/src/index.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.test.json',
    },
  },
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/integration/'],
  haste: {
    modulePathIgnorePatterns: ['/home/aragami/\\.bun/'],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
};
