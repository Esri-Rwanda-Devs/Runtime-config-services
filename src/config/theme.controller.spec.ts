import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigModule } from './config.module';

const HEADER = '/* Runtime Config shared typography (shared-theme) */\n';

describe('GET /api/v1/theme/typography.css', () => {
  let app: INestApplication<App>;
  let findFirst: jest.Mock;

  beforeEach(async () => {
    findFirst = jest.fn();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [],
    })
      .useMocker((token) =>
        token === PrismaService ? { application: { findFirst } } : undefined,
      )
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the active shared-theme typography as text/css', async () => {
    findFirst.mockResolvedValue({
      config: {
        branding: {
          typography: {
            navItem: { size: '12px', weight: 400, activeWeight: 600 },
          },
        },
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/theme/typography.css')
      .expect(200);

    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.text).toBe(
      [
        '/* Runtime Config shared typography (shared-theme) */',
        'html .workspace-menu-child,',
        'html .sidebar-link,',
        'html .modlist__item,',
        'html .modlist__item--form {',
        '  font-size: 12px;',
        '}',
        'html .workspace-menu-child,',
        'html .sidebar-link,',
        'html .modlist__item {',
        '  font-weight: 400;',
        '}',
        'html .workspace-menu-child.is-active,',
        'html .sidebar-link.is-on,',
        'html .modlist__item.is-active {',
        '  font-weight: 600;',
        '}',
        '',
      ].join('\n'),
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { key: 'shared-theme', isActive: true },
      select: { config: true },
    });
  });

  it.each([
    ['no active shared-theme row', null],
    ['no branding section', { config: { app: { name: 'Shared' } } }],
    ['no typography section', { config: { branding: { logo: '/l.png' } } }],
    ['a non-object config', { config: 'oops' }],
  ])('returns an empty stylesheet (200) for %s', async (_label, row) => {
    findFirst.mockResolvedValue(row);

    const res = await request(app.getHttpServer())
      .get('/api/v1/theme/typography.css')
      .expect(200)
      .expect('Content-Type', 'text/css; charset=utf-8');

    expect(res.text).toBe(HEADER);
  });

  it('emits no rules for a stored document with an unsafe value', async () => {
    // e.g. written straight to the DB, bypassing the admin API validation.
    findFirst.mockResolvedValue({
      config: {
        branding: {
          typography: {
            eyebrow: { size: '12px' },
            navItem: { size: '12px} body { display: none' },
          },
        },
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/theme/typography.css')
      .expect(200);

    expect(res.text).toBe(HEADER);
    expect(res.text).not.toContain('display');
  });

  it('keeps the runtime config route working alongside it', async () => {
    findFirst
      .mockResolvedValueOnce({ config: { app: { name: 'Infra' } } })
      .mockResolvedValueOnce(null);

    const res = await request(app.getHttpServer())
      .get('/api/v1/config/infrastructure-mapping')
      .expect(200)
      .expect('Content-Type', /application\/json/);

    expect(res.body).toEqual({ app: { name: 'Infra' } });
  });
});
