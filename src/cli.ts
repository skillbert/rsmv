import * as cmdts from "cmd-ts";
import { CliApiContext, cliApi } from "./clicommands";
import { cliArguments } from "./cliparser";
import { CLIScriptFS, CLIScriptOutput } from "./scriptrunner";

let ctx: CliApiContext = {
    getFs(fsname: string) { return new CLIScriptFS(fsname); },
    getConsole() { return new CLIScriptOutput(); }
}

let api = cliApi(ctx);

cmdts.run(api.subcommands, cliArguments());