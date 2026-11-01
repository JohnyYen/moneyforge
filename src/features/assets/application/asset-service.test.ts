import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import type { AssetInput, StreamInput } from './asset-use-cases';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const TODAY = '2026-03-10';
const localNoon = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
};

describe('assets', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let sequence: number;
  let now: Date;
  let typeId: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    now = localNoon(TODAY);
    services = createAppServices({
      driver,
      clock: { now: () => now },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
    });
    await services.ledger.initialize();
    unwrap(await services.ledger.setBaseCurrency('USD'));
    typeId = (await services.assets.listTypes())[0].id;
  });

  afterEach(() => driver.close());

  const account = async (name: string, currencyCode = 'USD', openingBalance = '0') =>
    unwrap(
      await services.ledger.createAccount({ name, type: 'Bank', currencyCode, openingBalance }),
    ).id;

  const assetInput = (change: Partial<AssetInput> = {}): AssetInput => ({
    name: 'Flat',
    typeId,
    currencyCode: 'USD',
    accountId: null,
    notes: '',
    ...change,
  });

  const asset = async (change: Partial<AssetInput> = {}) =>
    unwrap(await services.assets.createAsset(assetInput(change)));

  const rent = (change: Partial<StreamInput> = {}): StreamInput => ({
    name: 'Rent',
    kind: 'income',
    amount: '100',
    categoryId: null,
    schedule: { unit: 'day', every: 1, startOn: TODAY, endOn: null, dayOfMonth: null },
    ...change,
  });

  const monthlyFrom = (startOn: string) => ({ ...rent().schedule, unit: 'month' as const, startOn });

  const income = async (accountId: string, amount = '100', day = TODAY) =>
    unwrap(
      await services.ledger.recordIncome({
        accountId,
        amount,
        occurredAt: localNoon(day).toISOString(),
      }),
    );

  const expense = async (accountId: string, amount: string, day = TODAY) =>
    unwrap(
      await services.ledger.recordExpense({
        accountId,
        amount,
        occurredAt: localNoon(day).toISOString(),
      }),
    );

  const rate = (fromCode: string, value: string) =>
    services.ledger.saveRate({ fromCode, toCode: 'USD', rate: value, effectiveOn: '2026-01-01' });

  const horizon = { horizonDays: 2, includeBudgets: false };
  const month = { from: '2026-03-01', to: '2026-03-31' };

  describe('types', () => {
    it('seeds defaults that stay editable', async () => {
      const names = (await services.assets.listTypes()).map(({ name }) => name);
      expect(names).toEqual(
        expect.arrayContaining(['Real estate', 'Vehicle', 'Business', 'Investment', 'Other']),
      );

      const renamed = unwrap(await services.assets.saveType({ id: typeId, name: 'Homes' }));
      expect(renamed.name).toBe('Homes');
      unwrap(await services.assets.setTypeArchived(typeId, true));
      expect((await services.assets.listTypes()).find(({ id }) => id === typeId)).toMatchObject({
        name: 'Homes',
        archived: true,
      });
    });

    it('adds a type and refuses a blank one', async () => {
      const added = unwrap(await services.assets.saveType({ id: null, name: ' Art ' }));
      expect(added.name).toBe('Art');
      expect((await services.assets.saveType({ id: null, name: ' ' })).ok).toBe(false);
    });
  });

  describe('editing an asset', () => {
    it('refuses an account in another currency, since projecting it would need a rate', async () => {
      const pesos = await account('Pesos', 'COP');
      await expect(services.assets.createAsset(assetInput({ accountId: pesos }))).resolves.toMatchObject({
        ok: false,
        error: { code: 'currency-mismatch' },
      });
    });

    it('refuses an unknown type or account', async () => {
      expect((await services.assets.createAsset(assetInput({ typeId: 'x' }))).ok).toBe(false);
      expect((await services.assets.createAsset(assetInput({ accountId: 'x' }))).ok).toBe(false);
    });

    it('keeps the currency fixed, because values store its minor units', async () => {
      const flat = await asset();
      const updated = unwrap(
        await services.assets.updateAsset(flat.id, assetInput({ name: 'Home', currencyCode: 'EUR' })),
      );
      expect(updated).toMatchObject({ name: 'Home', currencyCode: 'USD' });
    });

    it('keeps its currency from changing decimals while an asset stores amounts in it', async () => {
      const [dai] = (await services.ledger.listCurrencies()).filter(({ code }) => code === 'DAI');
      await expect(services.ledger.updateCurrency({ ...dai, decimals: 6 })).resolves.toMatchObject({ ok: true });
      await asset({ currencyCode: 'DAI' }).then(({ id }) =>
        services.assets.addValuation(id, { valuedOn: TODAY, amount: '1' }),
      );
      await expect(services.ledger.updateCurrency({ ...dai, decimals: 18 })).resolves.toMatchObject({
        ok: false,
        error: { code: 'currency-in-use' },
      });
    });

    it('sells and reopens', async () => {
      const flat = await asset();
      const sold = unwrap(await services.assets.sellAsset(flat.id, '2026-03-01'));
      expect(sold).toMatchObject({ status: 'sold', soldOn: '2026-03-01' });
      const open = unwrap(await services.assets.reopenAsset(flat.id));
      expect(open).toMatchObject({ status: 'active', soldOn: null });
    });
  });

  describe('valuations', () => {
    it('keeps an 18 decimal history exactly, newest value current', async () => {
      const coin = await asset({ currencyCode: 'DAI' });
      const add = (valuedOn: string, amount: string) =>
        services.assets.addValuation(coin.id, { valuedOn, amount });
      unwrap(await add('2026-01-01', '1.000000000000000001'));
      unwrap(await add('2026-02-01', '123456789.123456789123456789'));

      const history = await services.assets.listValuations(coin.id);
      expect(history.map(({ amount }) => amount)).toEqual([
        123456789123456789123456789n,
        1000000000000000001n,
      ]);
      const report = unwrap(await services.assets.assetReport(coin.id, month));
      expect(report.latest?.amount).toBe(123456789123456789123456789n);
    });

    it('replaces a value on the same day', async () => {
      const flat = await asset();
      unwrap(await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '1' }));
      unwrap(await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '2' }));
      const history = await services.assets.listValuations(flat.id);
      expect(history.map(({ amount }) => amount)).toEqual([2_00n]);
    });

    it('never touches the ledger', async () => {
      const bank = await account('Bank', 'USD', '500');
      const flat = await asset({ accountId: bank });
      const ledgerRows = async () => ({
        balances: await services.ledger.accountBalances(),
        transactions: await driver.all('SELECT * FROM transactions'),
        postings: await driver.all('SELECT * FROM postings'),
      });
      const before = await ledgerRows();

      const added = unwrap(
        await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '250000' }),
      );
      unwrap(await services.assets.removeValuation(added.id));
      unwrap(await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '300000' }));

      expect(await ledgerRows()).toEqual(before);
      expect(unwrap(await services.ledger.netWorth()).total.minor).toBe(500_00n);
    });

    it('refuses a value in more decimals than the currency allows', async () => {
      const flat = await asset();
      const refused = await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '1.001' });
      expect(refused).toMatchObject({ ok: false, error: { code: 'too-precise' } });
      expect((await services.assets.addValuation('x', { valuedOn: TODAY, amount: '1' })).ok).toBe(false);
    });
  });

  describe('links', () => {
    it('survive an edit of the transaction and drop with its deletion', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      const paid = await income(bank);
      unwrap(await services.assets.linkTransaction({ transactionId: paid.id, assetId: flat.id, streamId: null }));

      unwrap(
        await services.ledger.updateTransaction(paid.id, {
          kind: 'income',
          accountId: bank,
          amount: '150',
          description: 'Corrected',
        }),
      );
      await expect(services.assets.getLink(paid.id)).resolves.toMatchObject({ assetId: flat.id });
      const report = unwrap(await services.assets.assetReport(flat.id, month));
      expect(report.actual.income).toBe(150_00n);

      unwrap(await services.ledger.deleteTransaction(paid.id));
      await expect(services.assets.getLink(paid.id)).resolves.toBeNull();
      await expect(driver.all('SELECT * FROM asset_transaction_links')).resolves.toEqual([]);
    });

    it('leaves the metadata of the transaction alone', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      const paid = await income(bank);
      unwrap(await services.assets.linkTransaction({ transactionId: paid.id, assetId: flat.id, streamId: null }));
      expect((await services.ledger.getTransaction(paid.id))?.metadata).toBeNull();
    });

    it('moves to another asset, and unlinks', async () => {
      const bank = await account('Bank');
      const [first, second] = [await asset(), await asset({ name: 'Car' })];
      const paid = await income(bank);
      const link = { transactionId: paid.id, streamId: null };
      unwrap(await services.assets.linkTransaction({ ...link, assetId: first.id }));
      unwrap(await services.assets.linkTransaction({ ...link, assetId: second.id }));
      await expect(services.assets.getLink(paid.id)).resolves.toMatchObject({ assetId: second.id });

      unwrap(await services.assets.unlinkTransaction(paid.id));
      await expect(services.assets.getLink(paid.id)).resolves.toBeNull();
    });

    it('refuses what is not income or expense, and a stream of the other kind or asset', async () => {
      const [bank, other] = [await account('Bank'), await account('Other')];
      const [flat, car] = [await asset(), await asset({ name: 'Car' })];
      const moved = unwrap(
        await services.ledger.recordTransfer({ fromAccountId: bank, toAccountId: other, amount: '1' }),
      );
      const paid = await income(bank);
      const cost = unwrap(await services.assets.createStream(flat.id, rent({ kind: 'expense' })));
      const elsewhere = unwrap(await services.assets.createStream(car.id, rent()));
      const link = (transactionId: string, streamId: string | null) =>
        services.assets.linkTransaction({ transactionId, assetId: flat.id, streamId });

      expect(await link(moved.id, null)).toMatchObject({ ok: false, error: { code: 'invalid-link' } });
      expect(await link(paid.id, cost.id)).toMatchObject({ ok: false, error: { code: 'invalid-link' } });
      expect(await link(paid.id, elsewhere.id)).toMatchObject({ ok: false, error: { code: 'invalid-link' } });
      expect(await link('x', null)).toMatchObject({ ok: false, error: { code: 'not-found' } });
      await expect(driver.all('SELECT * FROM asset_transaction_links')).resolves.toEqual([]);
    });

    it('lists what is linked, newest first', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      const [older, newer] = [await income(bank, '1', '2026-03-01'), await income(bank, '2')];
      await income(bank, '3');
      for (const { id } of [older, newer]) {
        unwrap(await services.assets.linkTransaction({ transactionId: id, assetId: flat.id, streamId: null }));
      }
      const listed = await services.assets.linkedTransactions(flat.id);
      expect(listed.map(({ id }) => id)).toEqual([newer.id, older.id]);
    });
  });

  describe('by a rule', () => {
    const BODY = 'Received 100.00 USD from tenant';

    const postedByRule = async (accountId: string, assetId: string, streamId: string | null) => {
      const source = unwrap(
        await services.rules.createSource({ name: 'Bank', channel: 'sms', sender: 'Bank', enabled: true }),
      );
      const rule = unwrap(
        await services.rules.createRule({
          sourceId: source.id,
          name: 'Rent',
          priority: 0,
          template: 'Received {amount} USD from tenant',
          format: { decimal: '.', thousands: ',' },
          kind: 'income',
          accountId,
          categoryId: null,
          counterpartAccountId: null,
          currencyCode: null,
          autoPost: true,
          splitMode: 'none',
          splitStructureId: null,
          samples: [],
        }),
      );
      unwrap(await services.assets.setRuleLink(rule.id, { assetId, streamId }));
      await services.rules.ingestMessage({
        channel: 'sms',
        sender: 'Bank',
        body: BODY,
        receivedAt: localNoon(TODAY).toISOString(),
      });
      const [transaction] = await services.ledger.listTransactions({ kind: 'income' });
      return { rule, transaction };
    };

    it('links what the rule posts, to the stream date it fulfils, and stops projecting it', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const stream = unwrap(await services.assets.createStream(flat.id, rent()));
      const { rule, transaction } = await postedByRule(bank, flat.id, stream.id);

      await expect(services.assets.getLink(transaction.id)).resolves.toMatchObject({
        assetId: flat.id,
        streamId: stream.id,
        dueOn: TODAY,
      });
      await expect(services.assets.listRuleLinks(flat.id)).resolves.toEqual([
        { ruleId: rule.id, assetId: flat.id, streamId: stream.id },
      ]);
      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([100_00n, 200_00n, 300_00n]);
    });

    it('leaves a date open when what the rule posted falls short of it', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const stream = unwrap(await services.assets.createStream(flat.id, rent({ amount: '150' })));
      const { transaction } = await postedByRule(bank, flat.id, stream.id);

      await expect(services.assets.getLink(transaction.id)).resolves.toMatchObject({ dueOn: TODAY });
      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances[0]).toBe(150_00n);
    });

    it('stops linking once the rule link is removed, and a removed rule drops it', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      const { rule } = await postedByRule(bank, flat.id, null);

      unwrap(await services.assets.setRuleLink(rule.id, null));
      await expect(services.assets.listRuleLinks(flat.id)).resolves.toEqual([]);
      unwrap(await services.assets.setRuleLink(rule.id, { assetId: flat.id, streamId: null }));
      unwrap(await services.rules.deleteRule(rule.id));
      await expect(services.assets.listRuleLinks(flat.id)).resolves.toEqual([]);
    });

    it('refuses an unknown rule, or a stream of another asset', async () => {
      const [flat, car] = [await asset(), await asset({ name: 'Car' })];
      const elsewhere = unwrap(await services.assets.createStream(car.id, rent()));
      const link = { assetId: flat.id, streamId: null };
      expect((await services.assets.setRuleLink('x', link)).ok).toBe(false);
      const bank = await account('Bank');
      const { rule } = await postedByRule(bank, flat.id, null);
      const wrong = { assetId: flat.id, streamId: elsewhere.id };
      expect((await services.assets.setRuleLink(rule.id, wrong)).ok).toBe(false);
    });
  });

  describe('streams and the projection', () => {
    it('adds expected flows to the linked account', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const flat = await asset({ accountId: bank });
      unwrap(await services.assets.createStream(flat.id, rent()));
      unwrap(
        await services.assets.createStream(flat.id, rent({ name: 'Upkeep', kind: 'expense', amount: '30' })),
      );

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([1070_00n, 1140_00n, 1210_00n]);
    });

    it('does not count a date an actual occurrence of that stream covers', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const stream = unwrap(await services.assets.createStream(flat.id, rent()));
      const paid = await income(bank);
      const link = await services.assets.linkTransaction({
        transactionId: paid.id,
        assetId: flat.id,
        streamId: stream.id,
      });
      expect(unwrap(link).dueOn).toBe(TODAY);

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([100_00n, 200_00n, 300_00n]);
    });

    it('counts a future date as covered by money received early, once', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const schedule = { ...rent().schedule, unit: 'month' as const, startOn: '2026-03-12' };
      const stream = unwrap(await services.assets.createStream(flat.id, rent({ schedule })));
      const paid = await income(bank);
      const link = { assetId: flat.id, streamId: stream.id };
      unwrap(await services.assets.linkTransaction({ ...link, transactionId: paid.id }));

      expect((await services.assets.getLink(paid.id))?.dueOn).toBe('2026-03-12');
      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([100_00n, 100_00n, 100_00n]);
    });

    it('gives a second payment the next open date', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const schedule = { ...rent().schedule, unit: 'month' as const, startOn: '2026-03-12' };
      const stream = unwrap(await services.assets.createStream(flat.id, rent({ schedule })));
      const [first, second] = [await income(bank), await income(bank)];
      for (const { id } of [first, second]) {
        unwrap(
          await services.assets.linkTransaction({ transactionId: id, assetId: flat.id, streamId: stream.id }),
        );
      }
      expect((await services.assets.getLink(second.id))?.dueOn).toBe('2026-04-12');
    });

    it('stops from the day an asset is sold, and comes back when reopened', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      unwrap(await services.assets.createStream(flat.id, rent()));
      unwrap(await services.assets.sellAsset(flat.id, TODAY));
      const stopped = unwrap(await services.planning.projectCashFlow(horizon));
      expect(stopped.accounts[0].balances).toEqual([0n, 0n, 0n]);

      unwrap(await services.assets.reopenAsset(flat.id));
      const back = unwrap(await services.planning.projectCashFlow(horizon));
      expect(back.accounts[0].balances).toEqual([100_00n, 200_00n, 300_00n]);
    });

    it('does not project a stream with no account, but still reports it', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      unwrap(await services.assets.createStream(flat.id, rent({ amount: '1' })));

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts.find(({ accountId }) => accountId === bank)?.balances).toEqual([0n, 0n, 0n]);
      const report = unwrap(await services.assets.assetReport(flat.id, month));
      expect(report.expected.income).toBe(22_00n);
    });

    it('edits and removes a stream, keeping what was linked', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      const stream = unwrap(await services.assets.createStream(flat.id, rent()));
      const edited = unwrap(await services.assets.updateStream(stream.id, rent({ amount: '7' })));
      expect(edited.amount).toBe(7_00n);
      const paid = await income(bank);
      unwrap(
        await services.assets.linkTransaction({ transactionId: paid.id, assetId: flat.id, streamId: stream.id }),
      );

      unwrap(await services.assets.removeStream(stream.id));
      await expect(services.assets.listStreams(flat.id)).resolves.toEqual([]);
      await expect(services.assets.getLink(paid.id)).resolves.toMatchObject({ assetId: flat.id, streamId: null });
    });

    it('saves every edited field of a stream', async () => {
      const flat = await asset();
      const stream = unwrap(await services.assets.createStream(flat.id, rent()));
      const upkeep = unwrap(
        await services.ledger.createCategory({ name: 'Upkeep', kind: 'expense', parentId: null }),
      );
      const schedule = {
        unit: 'month' as const,
        every: 2,
        startOn: '2026-04-01',
        endOn: '2026-12-01',
        dayOfMonth: 5,
      };
      const input = rent({
        name: 'Upkeep',
        kind: 'expense',
        amount: '7',
        categoryId: upkeep.id,
        schedule,
      });
      const expected = {
        id: stream.id,
        assetId: flat.id,
        name: 'Upkeep',
        kind: 'expense',
        amount: 7_00n,
        categoryId: upkeep.id,
        schedule,
      };

      expect(unwrap(await services.assets.updateStream(stream.id, input))).toEqual(expected);
      await expect(services.assets.getStream(stream.id)).resolves.toEqual(expected);
    });

    it('refuses a category of the other kind', async () => {
      const flat = await asset();
      const salary = unwrap(
        await services.ledger.createCategory({ name: 'Pay', kind: 'income', parentId: null }),
      );
      const input = rent({ kind: 'expense', categoryId: salary.id });
      await expect(services.assets.createStream(flat.id, input)).resolves.toMatchObject({
        ok: false,
        error: { code: 'category-mismatch' },
      });
    });

    it('nets a stream in a budgeted category against the reservation', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const flat = await asset({ accountId: bank });
      const food = unwrap(
        await services.ledger.createCategory({ name: 'Upkeep', kind: 'expense', parentId: null }),
      );
      unwrap(
        await services.planning.createBudget({
          name: 'Upkeep',
          currencyCode: 'USD',
          amount: '100',
          categoryIds: [food.id],
          period: { kind: 'monthly', startDay: null },
          rollover: false,
        }),
      );
      const schedule = monthlyFrom('2026-03-12');
      unwrap(
        await services.assets.createStream(
          flat.id,
          rent({ kind: 'expense', amount: '40', categoryId: food.id, schedule }),
        ),
      );

      const projection = unwrap(
        await services.planning.projectCashFlow({ horizonDays: 21, includeBudgets: true }),
      );
      expect(projection.total.balances.at(-1)).toBe(900_00n);
    });

    it('moves a paid date with a schedule edit, so it is not projected again', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const schedule = monthlyFrom('2026-03-10');
      const stream = unwrap(await services.assets.createStream(flat.id, rent({ schedule })));
      const paid = await income(bank);
      const link = { assetId: flat.id, streamId: stream.id, transactionId: paid.id };
      unwrap(await services.assets.linkTransaction(link));

      const moved = rent({ schedule: monthlyFrom('2026-03-11') });
      unwrap(await services.assets.updateStream(stream.id, moved));

      expect((await services.assets.getLink(paid.id))?.dueOn).toBe('2026-03-11');
      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([100_00n, 100_00n, 100_00n]);
    });

    it('projects what is left of a date until payments reach its amount', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const schedule = monthlyFrom(TODAY);
      const stream = unwrap(
        await services.assets.createStream(flat.id, rent({ amount: '1000', schedule })),
      );
      const linked = async (amount: string) => {
        const { id } = await income(bank, amount);
        unwrap(
          await services.assets.linkTransaction({ transactionId: id, assetId: flat.id, streamId: stream.id }),
        );
        return (await services.assets.getLink(id))?.dueOn;
      };
      const expectedToday = async () =>
        unwrap(await services.planning.projectCashFlow(horizon)).accounts[0].balances[0];

      await expect(linked('1')).resolves.toBe(TODAY);
      await expect(expectedToday()).resolves.toBe(1000_00n);
      await expect(linked('500')).resolves.toBe(TODAY);
      await expect(expectedToday()).resolves.toBe(1000_00n);
      await expect(linked('499')).resolves.toBe(TODAY);
      await expect(expectedToday()).resolves.toBe(1000_00n);
      await expect(linked('1000')).resolves.toBe('2026-04-10');
    });

    it('reads coverage from the transaction as it is now', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const stream = unwrap(
        await services.assets.createStream(flat.id, rent({ schedule: monthlyFrom(TODAY) })),
      );
      const paid = await income(bank);
      const link = { assetId: flat.id, streamId: stream.id, transactionId: paid.id };
      unwrap(await services.assets.linkTransaction(link));
      const edit = (entry: object) =>
        services.ledger.updateTransaction(paid.id, {
          kind: 'income',
          accountId: bank,
          amount: '100',
          occurredAt: localNoon(TODAY).toISOString(),
          ...entry,
        } as Parameters<typeof services.ledger.updateTransaction>[1]);
      const today = async () =>
        unwrap(await services.planning.projectCashFlow(horizon)).accounts[0].balances[0];

      unwrap(await edit({ amount: '60' }));
      await expect(today()).resolves.toBe(100_00n);

      unwrap(await edit({ amount: '100' }));
      await expect(today()).resolves.toBe(100_00n);

      unwrap(await edit({ kind: 'expense' }));
      await expect(services.assets.getLink(paid.id)).resolves.toMatchObject({ dueOn: null });
      await expect(today()).resolves.toBe(0n);

      unwrap(await edit({ kind: 'income', occurredAt: localNoon('2026-04-09').toISOString() }));
      await expect(services.assets.getLink(paid.id)).resolves.toMatchObject({ dueOn: '2026-04-10' });
      await expect(today()).resolves.toBe(200_00n);
    });

    it('moves no date for an edit the split refuses', async () => {
      const bank = await account('Bank');
      const savings = await account('Savings');
      const flat = await asset({ accountId: bank });
      const stream = unwrap(
        await services.assets.createStream(flat.id, rent({ schedule: monthlyFrom(TODAY) })),
      );
      const paid = await income(bank);
      const link = { assetId: flat.id, streamId: stream.id, transactionId: paid.id };
      unwrap(await services.assets.linkTransaction(link));
      const structure = unwrap(
        await services.split.createStructure({
          name: 'Salary',
          lines: [
            { label: 'Savings', targetAccountId: savings, percentage: null, isRemainder: true },
          ],
        }),
      );
      unwrap(
        await services.split.applyStructure({ transactionId: paid.id, structureId: structure.id }),
      );

      const moved = await services.ledger.updateTransaction(paid.id, {
        kind: 'expense',
        accountId: bank,
        amount: '100',
        occurredAt: paid.occurredAt,
      });

      expect(moved).toMatchObject({ ok: false, error: { code: 'confirmation-required' } });
      await expect(services.assets.getLink(paid.id)).resolves.toMatchObject({ dueOn: TODAY });
    });

    it('gives a date back when its payment goes', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      const stream = unwrap(
        await services.assets.createStream(flat.id, rent({ schedule: monthlyFrom('2026-03-12') })),
      );
      const [first, second, third] = [await income(bank), await income(bank), await income(bank)];
      for (const { id } of [first, second, third]) {
        unwrap(
          await services.assets.linkTransaction({ transactionId: id, assetId: flat.id, streamId: stream.id }),
        );
      }
      const dueDates = async () =>
        Promise.all(
          [first, second, third].map(async ({ id }) => (await services.assets.getLink(id))?.dueOn),
        );
      await expect(dueDates()).resolves.toEqual(['2026-03-12', '2026-04-12', '2026-05-12']);

      unwrap(await services.assets.unlinkTransaction(first.id));
      await expect(dueDates()).resolves.toEqual([undefined, '2026-03-12', '2026-04-12']);

      unwrap(await services.ledger.deleteTransaction(second.id));
      await expect(dueDates()).resolves.toEqual([undefined, undefined, '2026-03-12']);

      const other = unwrap(
        await services.assets.createStream(flat.id, rent({ name: 'Other', schedule: monthlyFrom(TODAY) })),
      );
      const moved = await income(bank);
      const link = { assetId: flat.id, streamId: stream.id, transactionId: moved.id };
      unwrap(await services.assets.linkTransaction(link));
      expect((await services.assets.getLink(moved.id))?.dueOn).toBe('2026-04-12');
      unwrap(await services.assets.linkTransaction({ ...link, transactionId: third.id, streamId: other.id }));
      expect((await services.assets.getLink(moved.id))?.dueOn).toBe('2026-03-12');
    });

    it('carries an unpaid past expense to today, so it can move the first negative day', async () => {
      const bank = await account('Bank', 'USD', '50');
      const flat = await asset({ accountId: bank });
      const schedule = monthlyFrom('2026-03-01');
      unwrap(
        await services.assets.createStream(flat.id, rent({ kind: 'expense', schedule })),
      );

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([-50_00n, -50_00n, -50_00n]);
      expect(projection.total.firstNegativeOn).toBe(TODAY);
    });

    it('does not carry an unpaid past income', async () => {
      const bank = await account('Bank');
      const flat = await asset({ accountId: bank });
      unwrap(await services.assets.createStream(flat.id, rent({ schedule: monthlyFrom('2026-03-01') })));

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual([0n, 0n, 0n]);
    });

    it('refuses a stream on an unknown asset or with a bad amount', async () => {
      const flat = await asset();
      expect((await services.assets.createStream('x', rent())).ok).toBe(false);
      expect((await services.assets.createStream(flat.id, rent({ amount: '0' }))).ok).toBe(false);
      expect((await services.assets.updateStream('x', rent())).ok).toBe(false);
    });
  });

  describe('reports', () => {
    it('computes an exact net yield from linked entries only', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      unwrap(await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '3000' }));
      const [paid, cost] = [await income(bank, '100'), await expense(bank, '10')];
      await income(bank, '999');
      for (const { id } of [paid, cost]) {
        unwrap(await services.assets.linkTransaction({ transactionId: id, assetId: flat.id, streamId: null }));
      }

      const report = unwrap(await services.assets.assetReport(flat.id, month));
      expect(report.actual).toEqual({ income: 100_00n, expense: 10_00n, net: 90_00n });
      expect(report.netYield).toEqual({ numerator: 3n, denominator: 100n });
    });

    it('refuses a bad range and an unknown asset', async () => {
      const flat = await asset();
      expect((await services.assets.assetReport(flat.id, { from: 'x', to: TODAY })).ok).toBe(false);
      expect((await services.assets.assetReport(flat.id, { from: TODAY, to: '2026-01-01' })).ok).toBe(false);
      expect((await services.assets.assetReport('x', month)).ok).toBe(false);
    });

    it('reports a missing rate on a linked entry in another currency', async () => {
      const pesos = await account('Pesos', 'COP');
      const flat = await asset();
      const paid = await income(pesos, '4000');
      unwrap(await services.assets.linkTransaction({ transactionId: paid.id, assetId: flat.id, streamId: null }));

      const report = unwrap(await services.assets.assetReport(flat.id, month));
      expect(report.missingRates).toEqual(['COP']);
      expect(report.actual.income).toBe(0n);

      unwrap(await rate('COP', '0.00025'));
      const converted = unwrap(await services.assets.assetReport(flat.id, month));
      expect(converted.missingRates).toEqual([]);
      expect(converted.actual.income).toBe(1_00n);
    });

    it('summarizes the portfolio in the base currency', async () => {
      const bank = await account('Bank');
      const flat = await asset();
      const peso = await asset({ name: 'Plot', currencyCode: 'COP' });
      unwrap(await rate('COP', '0.00025'));
      unwrap(await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '1000' }));
      unwrap(await services.assets.addValuation(peso.id, { valuedOn: TODAY, amount: '4000' }));
      const paid = await income(bank, '50');
      unwrap(await services.assets.linkTransaction({ transactionId: paid.id, assetId: flat.id, streamId: null }));

      const portfolio = unwrap(await services.assets.portfolio());
      expect(portfolio.totalValue).toEqual({ minor: 1001_00n, currency: 'USD' });
      expect(portfolio.monthlyNet).toEqual({ minor: 50_00n, currency: 'USD' });
      expect(portfolio.rows).toHaveLength(2);
    });

    it('keeps accounts the default net worth, with assets on request', async () => {
      await account('Bank', 'USD', '500');
      const flat = await asset();
      unwrap(await services.assets.addValuation(flat.id, { valuedOn: TODAY, amount: '1000' }));

      expect(unwrap(await services.ledger.netWorth()).total.minor).toBe(500_00n);
      const worth = unwrap(await services.assets.netWorthWithAssets());
      expect(worth.total).toEqual({ minor: 1500_00n, currency: 'USD' });

      unwrap(await services.assets.sellAsset(flat.id, TODAY));
      expect(unwrap(await services.assets.netWorthWithAssets()).total.minor).toBe(500_00n);
    });

    it('reports a rate missing from the total with assets', async () => {
      const peso = await asset({ currencyCode: 'COP' });
      unwrap(await services.assets.addValuation(peso.id, { valuedOn: TODAY, amount: '1' }));
      expect(unwrap(await services.assets.netWorthWithAssets()).missingRates).toEqual(['COP']);
    });
  });
});
