
export interface Order {
    symbol: string, // any valid ticker symbol
    // qty or notional required, not both
    qty?: number, // number of shares,
    notional?: number, // market/day orders only
    side: "buy" | "sell",
    type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop",
    time_in_force: "day" | "gtc" | "opg" | "ioc" | "fok",
    limit_price?: number, // required if type is limit or stop_limit
    stop_price?: number, // required if type is stop or stop_limit
    client_order_id?: string, // optional
    extended_hours?: boolean, // optional
    order_class?: "simple" | "bracket" | "oco" | "oto", // optional
    take_profit?: object, // optional,
    stop_loss?: object, // optional,
    trail_price?: number, // optional,
    trail_percent?: number, // optional,
}

export interface orderData {
    order: Order,
    account: string,
    exchange: string,
    userID: string,
    key: string,
    paper?: boolean,
}
