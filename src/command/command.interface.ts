import { Target } from "../core.interface";


export enum CategoryCommand {
    COMMAND = "command",
}

export enum CommandType {
    STOP_NODE = "stop-node",
}

export interface Command extends Target {
    name: CommandType;
    /** Node.id */
    value: string;
    category: CategoryCommand;
}