it("paces requests and honors Retry-After without retrying permanent errors", async () => {
    jest.useFakeTimers(); jest.resetModules();
    const { Anilist } = require("../src/request");
    const calls: number[] = [];
    const mock = jest.spyOn(global,"fetch").mockImplementation(async () => {
        calls.push(Date.now());
        return calls.length === 1 ? new Response("{}",{status:429,headers:{"Retry-After":"10"}}) : new Response('{"data":{}}');
    });
    try {
        const client = new Anilist();
        const first = client.fetch("one"), second = client.fetch("two");
        await jest.runAllTimersAsync();
        await Promise.all([first,second]);
        expect(calls).toHaveLength(3);
        expect(calls[1]-calls[0]).toBeGreaterThanOrEqual(10000);
        expect(calls[2]-calls[1]).toBeGreaterThanOrEqual(2200);
        mock.mockResolvedValue(new Response("{}",{status:403}));
        const failed = expect(client.fetch("three")).rejects.toThrow("403");
        await jest.runAllTimersAsync(); await failed;
        expect(mock).toHaveBeenCalledTimes(4);
    } finally { mock.mockRestore(); jest.useRealTimers(); }
});

it("keeps the server cooldown after exhausting retries before the next queued request", async () => {
    jest.useFakeTimers(); jest.resetModules();
    const { Anilist } = require("../src/request");
    const times: number[]=[];
    const mock=jest.spyOn(global,"fetch").mockImplementation(async()=>{
        times.push(Date.now());
        return times.length<=4 ? new Response("{}",{status:429,headers:{"Retry-After":"10"}}) : new Response('{"data":{}}');
    });
    try {
        const client=new Anilist();
        const failed=expect(client.fetch("one")).rejects.toThrow("429");
        const next=client.fetch("two");
        await jest.runAllTimersAsync(); await failed; await next;
        expect(times).toHaveLength(5);
        expect(times[4]-times[3]).toBeGreaterThanOrEqual(10000);
    } finally {mock.mockRestore();jest.useRealTimers();}
});
