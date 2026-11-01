import { createSubmitGate } from './submit-gate';

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
