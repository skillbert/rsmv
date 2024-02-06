# RS3 Clientscript


### VM design
The cs2 VM is a stack machine which uses supports three primitive types (int,long,string). All types can be represtend by one of those three. The VM keeps a seperate stack for each of these primitives.

#### The stacks
- There are tree stacks (int,long,string).
- You can only access to last pushed value per stack
- However the VM does not enforce ordered access so eg: pushint->pushstring->popint->popstring would be valid
  - The Jagex cs2 compiler generally avoids this, but it can happen for script calls
- The total stack size for each stack is limited to 1000 entries
- There seems to be no hardcoded string length limit


#### Scripts calls
- Functions get their own set of local variables (similar to registers), the number of vars is declared in the script metadata
- When a script is called its arguments will be popped from stack and placed in the corresponding local variable slots.
- Callees do not get an isolated stack. It is possible (but highly discouraged) to pop values from stack that weren't defined as script argument.
- The stack is not used to store local variables when calling another script.
  - presumably this means that there is a seperate recursion limit caused by some sort of "local variable stack"


#### Branching
- The max script length seems to be 65535 ops. After that weird stuff starts happening
- All jumps are relative. (relative to index + 1)
- When none of the switch branches match the VM will simply go to the next instruction
- Switch statements can only jump forward
- All other branching ops can go back and forward

#### Arrays
- Arrays are weird