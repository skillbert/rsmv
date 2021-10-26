

export type SubFile = {
	offset: number,
	size: number,
	buffer: Buffer
}

export type CacheIndexStub = {
	major: number,
	minor: number,
	crc: number,
	version: number
}

export type CacheIndex = CacheIndexStub & {
	uncompressed_crc: number,
	size: number,
	uncompressed_size: number,
	subindexcount: number,
	subindices: number[]
}

export function packSqliteBufferArchive(buffers: Buffer[]) {
	if (buffers.length == 1) { return buffers[0]; }
	let datasize = buffers.reduce((a, v) => a + v.byteLength, 0);;
	let headersize = 1 + 4 + buffers.length * 4
	let result = Buffer.alloc(headersize + datasize);
	let offset = 0;
	let dataoffset = headersize;//start of first file
	result.writeUInt8(0x1, offset); offset++;//unknown
	result.writeUInt32BE(dataoffset, offset); offset += 4;
	for (let buffer of buffers) {
		buffer.copy(result, dataoffset);
		dataoffset += buffer.byteLength;
		result.writeUInt32BE(dataoffset, offset); offset += 4;//index at end of file
	}
	return result;
}

export function unpackSqliteBufferArchive(buffer: Buffer, length: number) {
	if (length == 1) {
		return [{ buffer, offset: 0, size: buffer.byteLength }];
	}
	let index = 0;
	let unknownbyte = buffer.readUInt8(index); index++;
	//console.log("unknownbyte sqlarchive", unknownbyte);
	let fileoffset = buffer.readUInt32BE(index); index += 4;

	let files: SubFile[] = [];
	for (let filenr = 0; filenr < length; filenr++) {
		let endoffset = buffer.readUInt32BE(index); index += 4;
		files.push({
			buffer: buffer.slice(fileoffset, endoffset),
			offset: fileoffset,
			size: endoffset - fileoffset
		});
		fileoffset = endoffset;
	}
	return files;
}

export function packBufferArchive(buffers: Buffer[]) {
	if (buffers.length == 1) { return buffers[0]; }
	let datasize = buffers.reduce((a, v) => a + v.byteLength, 0);;
	let len = 1 + buffers.length * 4 + datasize;
	let result = Buffer.alloc(len);
	let lastsize = 0;
	let footerindex = datasize;
	let offset = 0;
	for (let buf of buffers) {
		buf.copy(result, offset);
		offset += buf.byteLength;
		result.writeInt32BE(buf.byteLength - lastsize, footerindex);
		lastsize = buf.byteLength;
		footerindex += 4;
	}
	return result;
}

export function unpackBufferArchive(buffer: Buffer, length: number) {
	var subbufs: SubFile[] = [];
	var scan = 0x0;
	//whats in our missing byte?
	var suboffsetScan = buffer.length - 0x1 - (0x4 * length);
	var lastRecordSize = 0;

	for (var j = 0; j < length; ++j) {
		let size: number;
		if (length == 1) {
			size = buffer.byteLength;
		} else {
			//the field contains the difference in size from the last record?
			lastRecordSize += buffer.readInt32BE(suboffsetScan);
			suboffsetScan += 4;
			size = lastRecordSize;
		}
		let recordBuffer = buffer.slice(scan, scan + size);
		scan += size;
		subbufs.push({
			buffer: recordBuffer,
			offset: scan,
			size
		})
	}
	return subbufs;
}
export function rootIndexBufferToObject(metaindex: Buffer) {
	var indices: { [key: number]: CacheIndexStub } = {};
	var offset = 0x0;
	var elements = metaindex.readUInt8(offset++);
	for (var i = 0; i < elements; ++i, offset += 0x50) {
		var element = metaindex.slice(offset, offset + 0x50);
		//skip empty indices
		if (Math.max.apply(null, element) == 0) {
			continue;
		}
		indices[i] = {
			major: 255,
			minor: i,
			crc: element.readUInt32BE(0),
			version: element.readUInt32BE(0x4)
		};
	}
	return indices;
}

export function indexBufferToObject(major: number, buffer: Buffer) {
	var count = 0;
	var scan = 0x6;
	if ((buffer.readUInt8(0x6) & 0x80) == 0x80)
		count = (buffer.readUInt32BE(scan) & 0x7FFFFFFF), scan += 4;
	else
		count = buffer.readUInt16BE(scan), scan += 2;

	var index: CacheIndex[] = []
	var minor = 0;
	var biggestCount = -1;
	for (var i = 0; i < count; ++i) {
		minor += buffer.readUInt16BE(scan), scan += 2;
		index[i] = { "major": major, "minor": minor } as any;
	}
	for (var i = 0; i < count; ++i)
		index[i].crc = buffer.readUInt32BE(scan), scan += 4;
	for (var i = 0; i < count; ++i)
		index[i].uncompressed_crc = buffer.readUInt32BE(scan), scan += 4;
	for (var i = 0; i < count; ++i) {
		index[i].size = buffer.readUInt32BE(scan), scan += 4;
		index[i].uncompressed_size = buffer.readUInt32BE(scan), scan += 4;
	}
	for (var i = 0; i < count; ++i)
		index[i].version = buffer.readUInt32BE(scan), scan += 4;
	for (var i = 0; i < count; ++i) {
		index[i].subindexcount = buffer.readUInt16BE(scan), scan += 2;
		if (index[i].subindexcount > biggestCount)
			biggestCount = index[i].subindexcount;
	}
	for (var i = 0; i < count; ++i) {
		index[i].subindices = [];
		let subindex = index[i].minor * biggestCount;
		for (var j = 0; j < index[i].subindexcount; ++j) {
			subindex += buffer.readUInt16BE(scan), scan += 2;
			index[i].subindices.push(subindex);
		}
	}
	//fs.writeFileSync(`${cachedir}/test_index.json`, JSON.stringify(index, null, 4));
	//console.log(index);

	return index;
}