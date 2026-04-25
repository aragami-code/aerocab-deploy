describe('Integration test infrastructure smoke test', () => {
  it('DATABASE_URL points to test DB', () => {
    expect(process.env.DATABASE_URL).toContain('5433');
  });

  it('JWT_SECRET is set', () => {
    expect(process.env.JWT_SECRET).toBe('test-jwt-secret-integration');
  });
});
