import { err, ok, type Result } from '@/shared/result';

import { createSubmitGate, runSubmission, SAVED_BUT_STUCK } from './submit-gate';

describe('createSubmitGate', () => {
  it('admits one submission at a time', () => {
    const gate = createSubmitGate(false);

    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
  });

  it('reopens after a failure, so the form can be corrected and resent', () => {
    const gate = createSubmitGate(true);
    gate.tryEnter();

    gate.leave(false);

    expect(gate.isClosed()).toBe(false);
    expect(gate.tryEnter()).toBe(true);
  });

  it('stays closed after a success on a screen that exits', () => {
    const gate = createSubmitGate(true);
    gate.tryEnter();

    gate.leave(true);

    expect(gate.isClosed()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
  });

  it('reopens after a success on a screen that stays', () => {
    const gate = createSubmitGate(false);
    gate.tryEnter();

    gate.leave(true);

    expect(gate.tryEnter()).toBe(true);
  });
});

describe('runSubmission', () => {
  const run = async ({
    exits = true,
    action = async () => ok('saved'),
    onSuccess = () => undefined,
  }: {
    exits?: boolean;
    action?: () => Promise<Result<string, { message: string }>>;
    onSuccess?: (value: string) => void | Promise<void>;
  }) => {
    const gate = createSubmitGate(exits);
    const errors: string[] = [];
    gate.tryEnter();
    await runSubmission(gate, { action, onSuccess, onError: (message) => errors.push(message) });
    return { gate, errors };
  };

  it('hands the value on and stays closed after a success that exits', async () => {
    const onSuccess = jest.fn();

    const { gate, errors } = await run({ onSuccess });

    expect(onSuccess).toHaveBeenCalledWith('saved');
    expect(errors).toEqual([]);
    expect(gate.isClosed()).toBe(true);
  });

  it('reports a rule error and reopens', async () => {
    const { gate, errors } = await run({
      action: async () => err({ message: 'Not allowed.' }),
    });

    expect(errors).toEqual(['Not allowed.']);
    expect(gate.tryEnter()).toBe(true);
  });

  it('reports a storage failure and reopens', async () => {
    const { gate, errors } = await run({
      action: () => Promise.reject(new Error('disk full')),
    });

    expect(errors).toEqual(['disk full']);
    expect(gate.tryEnter()).toBe(true);
  });

  it.each([
    ['throws', () => { throw new Error('no navigator'); }],
    ['rejects', () => Promise.reject(new Error('no navigator'))],
  ])('tells the user the change was saved when leaving %s', async (_, onSuccess) => {
    const { gate, errors } = await run({ onSuccess });

    expect(errors).toEqual([SAVED_BUT_STUCK]);
    expect(gate.tryEnter()).toBe(false);
  });

  it('stays open when a screen that stays fails after saving', async () => {
    const { gate, errors } = await run({
      exits: false,
      onSuccess: () => {
        throw new Error('reload failed');
      },
    });

    expect(errors).toEqual([SAVED_BUT_STUCK]);
    expect(gate.tryEnter()).toBe(true);
  });
});
