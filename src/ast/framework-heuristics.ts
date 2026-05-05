/**
 * Framework Heuristics
 *
 * Deterministic role detection based on path strings + AST inheritance/attributes.
 * A single file may match multiple roles — the result is an array.
 */

export function detectFrameworkRoles(source: string, filePath: string): string[] {
  const roles: string[] = [];
  const path = filePath.replace(/\\/g, '/');

  // Symfony — Controller
  if (
    /\/Controller\//.test(path) ||
    /\bclass\s+\w+\s+extends\s+AbstractController\b/.test(source)
  ) {
    roles.push('Symfony:Controller');
  }

  // Symfony — Entity
  if (
    /\/Entity\//.test(path) ||
    /#\[\s*ORM\\Entity\b/.test(source)
  ) {
    roles.push('Symfony:Entity');
  }

  // Symfony — EventSubscriber
  if (/\bclass\s+\w+\s+(?:extends\s+\w+\s+)?implements\s+[^{]*\bEventSubscriberInterface\b/.test(source)) {
    roles.push('Symfony:EventSubscriber');
  }

  // Symfony — Security
  if (
    /\/Security\//.test(path) ||
    /\bclass\s+\w+\s+(?:extends\s+\w+\s+)?implements\s+[^{]*\bAuthenticatorInterface\b/.test(source)
  ) {
    roles.push('Symfony:Security');
  }

  return roles;
}
