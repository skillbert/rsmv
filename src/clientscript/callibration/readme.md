
## problem statement ##
There are >1000 hardcoded opcodes in the client, about 100 of these are core language ops and the rest of simply calls into client code. Each client update shuffles the ids of these opcodes randomly. RSMV automatically takes any cache and characterizes all opcodes used in its scripts to find their encoding and to find their arguments and return types.

there are 4 main things that have to solved for
- opcode imm encodings
  - opcodes can have embedded data, this makes their encoding variable size
  - `findOpcodeImmidiates()`
- opcode arguments and returns (primitives)
  - primitivs are int32, string, int64
  - each opcode pops some from stack and then pushes others onto stack
  - a small set of dynamic opcodes are hardcoded
  - `callibrateOperants()`
- type specialisations of opcode/script args and returns
  - an int32 can have many different meanings, eg obj/npc/stat/enum/dbrow/coordgrid
  - `callibrateSubtypes()`
- opcode names
  - needed to make code readable
  - propagated from known reference caches in 2011 and 2023

## Call sequence ##
`prepareClientScript()`
- `ClientscriptObfuscation.create(currentcache)`
  - returns and uses caches deob if one exists
  - ClientscriptObfuscation.preloadData();
    - loads vars and dbtables
  - `loadCandidates()`;
    - loads all scripts of the cache as buffers ~20k
  - `ClientscriptObfuscation.runAutoCallibrate()`
    - if buildnr<668 hardcoded non-obfuscated opcodes and returns
	- `refdump = getReferenceOpcodeDump()`
      - loads the last non-obbed cache and then callibrates a second reference cache from it
	  - `rootdeob = ClientscriptObfuscation.create(<non-obbed 2011 cache>)`
	  - `refdeob = ClientscriptObfuscation.create(<2023 reference cache>)`
	  - `refdeob.runCallibrationFrom(rootdeob)`
	- `runCallibrationFrom(refdump)`
      - callibrates the current cache using hints from the reference cache
	  - `copyOpcodesFrom()`
	    - tries to match encoding from reference cache
	    - contributes ~200 encodings
	    - probably helps bootstrap the self callibration
      - `findOpcodeImmidiates()`
        - sorts scripts by length and tries to find valid encodings
        - `parseCandidateContents()`
          - all candidates now have a list of ops/imms but without known meaning
      - `callibrateOperants()`
	    - splits scripts into stack neutral sections
		- known pushes/pops are used to identify unknown ops
	    - most/all opcodes now have known args/returns
      - `callibrateSubtypes()`
	    - propagates known subtypes accross pop/pushes, local vars and script args
		- nucleated mostly by hardcoded dynamic ops
