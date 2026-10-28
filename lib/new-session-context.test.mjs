import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  contextForCwd,
  describeProjectChoices,
  mergeProjectChoices,
  newSessionContextKey,
  newSessionTargetForProject,
  withProjectAlias
} = await jiti.import('./new-session-context.ts');

const context = {
  cwd: '/work/app',
  project: { key: 'app-key', root: '/work/app' },
  projects: [
    { key: 'app-key', root: '/work/app' },
    { key: 'other-key', root: '/work/other' }
  ]
};

test("a project's new-session actions share the selected directory only for the current project", () => {
  const project = { key: 'app-key', root: '/work/app', current: true };
  const at = (cwd) => ({ cwd, projectKey: project.key, projectRoot: project.root });
  assert.deepEqual(newSessionTargetForProject(project, '/work/app/subdir'), at('/work/app/subdir'));
  assert.deepEqual(newSessionTargetForProject(project, '/work/app/subdir'), at('/work/app/subdir'));
  assert.deepEqual(newSessionTargetForProject(project, project.root), at(project.root));
  assert.deepEqual(newSessionTargetForProject(project, null), at(project.root));
  assert.deepEqual(
    newSessionTargetForProject({ ...project, current: false }, '/work/app/subdir'),
    at(project.root)
  );
  assert.deepEqual(
    newSessionTargetForProject({ ...project, current: false }, null),
    at(project.root)
  );
});

test('a pinned project with no sessions needs only its key and root to open a new composer', () => {
  const project = { key: 'empty-key', root: 'C:\\Projects\\Empty & 项目', current: false };
  assert.deepEqual(newSessionTargetForProject(project, 'C:\\Projects\\Other'), {
    cwd: project.root,
    projectKey: project.key,
    projectRoot: project.root
  });
});

test("the sidebar's groups come first, then projects only its sessions know", () => {
  assert.deepEqual(
    mergeProjectChoices(
      [
        { key: 'b', root: '/b', name: 'b', pinned: true },
        { key: 'a', root: '/a' }
      ],
      [
        { key: 'a', root: '/a' },
        { key: 'c', root: '/c' }
      ]
    ),
    [
      { key: 'b', root: '/b' },
      { key: 'a', root: '/a' },
      { key: 'c', root: '/c' }
    ]
  );
});

test('project names get their parent folder only when two of them collide', () => {
  assert.deepEqual(
    describeProjectChoices([
      { key: '1', root: '/work/client/app' },
      { key: '2', root: '/work/server/app/' },
      { key: '3', root: 'C:\\code\\tools' },
      { key: '4', root: '/app' }
    ]).map(({ name, note }) => [name, note]),
    [
      ['app', 'client'],
      ['app', 'server'],
      ['tools', null],
      ['app', null]
    ]
  );
});

test('a project the user named shows that name, by key, with its folder as the note', () => {
  // A key such as "constructor" never reads Object.prototype's member as a name.
  const names = { a: 'Thermal Models', c: 'Thermal Models' };
  const merged = mergeProjectChoices(
    [
      {
        key: 'a',
        root: '/work/sim/thermal',
        name: 'Thermal Models',
        customName: 'Thermal Models',
        pinned: false
      },
      { key: 'b', root: '/work/b' }
    ],
    [
      { key: 'c', root: '/old/thermal' },
      { key: 'constructor', root: '/work/constructor' }
    ],
    names
  );
  assert.deepEqual(merged, [
    { key: 'a', root: '/work/sim/thermal', alias: 'Thermal Models' },
    { key: 'b', root: '/work/b' },
    { key: 'c', root: '/old/thermal', alias: 'Thermal Models' },
    { key: 'constructor', root: '/work/constructor' }
  ]);
  assert.deepEqual(
    withProjectAlias({ key: 'b', root: '/work/b', alias: 'stale' }, names),
    { key: 'b', root: '/work/b' },
    'the names decide, not a stale alias'
  );
  assert.deepEqual(withProjectAlias({ key: 'a', root: '/r' }, undefined), { key: 'a', root: '/r' });
  // Two projects may share a name: a named one has no note, the path tooltip tells it apart.
  assert.deepEqual(
    describeProjectChoices([...merged, { key: 'd', root: '/x/b' }]).map(({ name, note }) => [
      name,
      note
    ]),
    [
      ['Thermal Models', null],
      ['b', 'work'],
      ['Thermal Models', null],
      ['constructor', null],
      ['b', 'x']
    ]
  );
});

test('a move to a named project shows its name before the sidebar reports it', () => {
  const projects = [
    { key: 'app-key', root: '/work/app', alias: 'App' },
    { key: 'lib-key', root: '/work/lib', alias: 'Library' }
  ];
  const named = { ...context, projects };
  assert.deepEqual(contextForCwd(named, '/work/lib').project, {
    key: 'lib-key',
    root: '/work/lib',
    alias: 'Library'
  });
  // A move names its project by key and root only.
  const move = { cwd: '/work/lib', project: { key: 'lib-key', root: '/work/lib' }, branch: null };
  assert.deepEqual(contextForCwd(named, '/work/lib', move).project, {
    key: 'lib-key',
    root: '/work/lib',
    alias: 'Library'
  });
  assert.deepEqual(contextForCwd(named, '/tmp/new').project, { key: '/tmp/new', root: '/tmp/new' });
  // A rename is something the bar shows: it hears of it.
  assert.notEqual(
    newSessionContextKey({ ...context, project: { ...context.project, alias: 'App' } }),
    newSessionContextKey(context)
  );
  assert.notEqual(newSessionContextKey(named), newSessionContextKey(context));
});
