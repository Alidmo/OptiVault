import { describe, it, expect } from 'vitest';
import { detectFrameworkRoles } from './framework-heuristics.js';
import { formatVaultNote } from '../compression/formatter.js';

describe('detectFrameworkRoles — Symfony', () => {
  it('detects Controller by path', () => {
    const roles = detectFrameworkRoles('class FooController {}', 'src/Controller/FooController.php');
    expect(roles).toContain('Symfony:Controller');
  });

  it('detects Controller by AbstractController inheritance', () => {
    const src = `class FooController extends AbstractController {}`;
    const roles = detectFrameworkRoles(src, 'src/Web/Foo.php');
    expect(roles).toContain('Symfony:Controller');
  });

  it('detects Entity by path', () => {
    const roles = detectFrameworkRoles('class User {}', 'src/Entity/User.php');
    expect(roles).toContain('Symfony:Entity');
  });

  it('detects Entity by ORM\\Entity attribute', () => {
    const src = `#[ORM\\Entity(repositoryClass: UserRepository::class)]\nclass User {}`;
    const roles = detectFrameworkRoles(src, 'src/Domain/User.php');
    expect(roles).toContain('Symfony:Entity');
  });

  it('detects EventSubscriber by interface', () => {
    const src = `class CartSubscriber implements EventSubscriberInterface { public static function getSubscribedEvents(): array { return []; } }`;
    const roles = detectFrameworkRoles(src, 'src/EventListener/CartSubscriber.php');
    expect(roles).toContain('Symfony:EventSubscriber');
  });

  it('detects Security by path', () => {
    const roles = detectFrameworkRoles('class TokenAuth {}', 'src/Security/TokenAuth.php');
    expect(roles).toContain('Symfony:Security');
  });

  it('detects Security by AuthenticatorInterface', () => {
    const src = `class TokenAuth extends AbstractAuthenticator implements AuthenticatorInterface {}`;
    const roles = detectFrameworkRoles(src, 'src/Auth/TokenAuth.php');
    expect(roles).toContain('Symfony:Security');
  });

  it('returns multiple roles when a file matches several rules', () => {
    const src = `#[ORM\\Entity]\nclass User {}`;
    const roles = detectFrameworkRoles(src, 'src/Entity/User.php');
    expect(roles).toContain('Symfony:Entity');
    expect(roles.length).toBe(1);
  });

  it('returns empty array when no rule matches', () => {
    const roles = detectFrameworkRoles('class Helper {}', 'src/Util/Helper.php');
    expect(roles).toEqual([]);
  });
});

describe('formatVaultNote — roles in YAML frontmatter', () => {
  it('emits roles array in frontmatter', () => {
    const note = formatVaultNote({
      filePath: 'src/Entity/User.php',
      deps: [],
      exports: ['User'],
      roles: ['Symfony:Entity'],
    });
    expect(note).toContain('roles: ["Symfony:Entity"]');
  });

  it('emits multiple roles', () => {
    const note = formatVaultNote({
      filePath: 'src/Controller/UserController.php',
      deps: [],
      exports: ['UserController'],
      roles: ['Symfony:Controller', 'Symfony:Security'],
    });
    expect(note).toContain('roles: ["Symfony:Controller", "Symfony:Security"]');
  });

  it('omits roles line when none', () => {
    const note = formatVaultNote({
      filePath: 'src/Util/Helper.php',
      deps: [],
      exports: ['Helper'],
    });
    expect(note).not.toContain('roles:');
  });
});
