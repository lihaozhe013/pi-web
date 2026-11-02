#!/usr/bin/env node
/**
 * Scripted Pi RPC child used by the queue tests.
 *
 * It speaks the documented record families (commands, responses, session events,
 * extension UI requests) without needing a model or the installed CLI. The
 * scenario is the first argument.
 */
const scenario = process.argv[2] ?? 'success';
const OTHER = 'Write my own answer…';
const questions = new Map();

function send(record) {
  process.stdout.write(JSON.stringify(record) + '\n');
}

function response(command, data) {
  send({ id: command.id, type: 'response', command: command.type, success: true, data });
}

function settle(aborted, text) {
  if (text !== undefined) {
    send({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text }] }
    });
  }
  send({ type: 'agent_end', messages: [], willRetry: false });
  send({ type: 'agent_settled', aborted });
}

function run(text) {
  send({ type: 'agent_start' });
  send({ type: 'message_start', message: { role: 'assistant', content: [] } });
  send({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text }
  });
  send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  send({ type: 'agent_end', messages: [], willRetry: false });
  send({ type: 'agent_settled', aborted: false });
}

function onPrompt(command) {
  response(command, { disposition: 'started' });
  if (scenario === 'crash') {
    process.exit(2);
  }
  if (scenario === 'timeout') {
    send({ type: 'agent_start' });
    return;
  }
  if (scenario === 'slow') {
    setTimeout(() => run('Slow but done'), 150);
    return;
  }
  if (scenario === 'u2028') {
    run('answer\u2028with separator');
    return;
  }
  if (scenario === 'question') {
    questions.set('q1', 'select');
    send({
      type: 'extension_ui_request',
      id: 'q1',
      method: 'select',
      title: 'Which layout?',
      options: ['Sidebar', 'Tabs', OTHER]
    });
    return;
  }
  if (scenario === 'stubborn') {
    setInterval(() => {}, 1_000);
    return;
  }
  if (scenario === 'fail') {
    process.exitCode = 3;
    settle(false, 'Finished with a failure');
    return;
  }
  run('Done: changed one file');
}

function onUiResponse(command) {
  const kind = questions.get(command.id);
  if (kind === 'select') {
    questions.delete(command.id);
    if (command.cancelled) {
      settle(false, 'dismissed');
      return;
    }
    if (command.value === OTHER) {
      questions.set('q2', 'input');
      send({
        type: 'extension_ui_request',
        id: 'q2',
        method: 'input',
        title: 'Which layout?',
        placeholder: 'type'
      });
      return;
    }
    settle(false, `option:${command.value}`);
    return;
  }
  if (kind === 'input') {
    questions.delete(command.id);
    settle(false, command.cancelled ? 'dismissed' : `typed:${command.value}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, '');
    buffer = buffer.slice(newline + 1);
    if (line.trim()) {
      const command = JSON.parse(line);
      if (command.type === 'prompt') onPrompt(command);
      else if (command.type === 'abort') {
        response(command);
        if (scenario !== 'stubborn') settle(true, undefined);
      } else if (command.type === 'extension_ui_response') onUiResponse(command);
      else response(command, {});
    }
    newline = buffer.indexOf('\n');
  }
});
process.stdin.on('end', () => {
  process.exit(process.exitCode ?? 0);
});
