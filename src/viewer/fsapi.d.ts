
declare var FileSystemHandle: {
	prototype: WebkitFsHandle;
	new(): WebkitFsHandle;
};

declare function showSaveFilePicker(options?: any): Promise<WebkitFileHandle>;
declare function showDirectoryPicker(options?: any): Promise<WebkitDirectoryHandle>;

type WebkitFsHandleBase = {
	kind: string,
	name: string,

	requestPermission(): Promise<any>;
	queryPermission(): Promise<any>;
}
type WebkitFsWritable = {
	write(data: any): Promise<void>,
	close(): Promise<void>
}
type WebkitFsHandle = WebkitDirectoryHandle | WebkitFileHandle;
type WebkitFileHandle = WebkitFsHandleBase & {
	kind: "file",
	createWritable(): Promise<WebkitFsWritable>,
	getFile(): Promise<File>
}
type WebkitDirectoryHandle = WebkitFsHandleBase & {
	kind: "directory",
	getFileHandle(name: string, opt?: { create: boolean }): Promise<WebkitFileHandle>,
	values(): AsyncIterable<WebkitFsHandle>
}