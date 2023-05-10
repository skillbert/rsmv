
/**
 * Extracted from a decompiled rshd client. several changes are made to
 * isolate the code and in order to interop with js more easily
 * Other changes were made in order to enforce i32 wrapping behavior
 * while js uses doubles mostly in rng code.
 */
(function(){


//////////////////////////////////////////////////////////////////
///////////////////// start of generated code ////////////////////
//////////////////////////////////////////////////////////////////
/* Generated from Java with JSweet 3.1.0 - http://www.jsweet.org */
class ArrayUtils {
    static copy$byte_A$int$byte_A$int$int(src, srcOff, dest, destOff, len) {
        if (src === dest) {
            if (srcOff === destOff) {
                return;
            }
            if (destOff > srcOff && destOff < srcOff + len) {
                len--;
                let srcOff2 = srcOff + len;
                let destOff2 = destOff + len;
                len = srcOff2 - len;
                len += 7;
                while ((srcOff2 >= len)) {
                    {
                        let destOff3 = destOff2 - 1;
                        let srcOff3 = srcOff2 - 1;
                        dest[destOff2] = src[srcOff2];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        destOff2 = destOff3 - 1;
                        srcOff2 = srcOff3 - 1;
                        dest[destOff3] = src[srcOff3];
                    }
                }
                ;
                len -= 7;
                while ((srcOff2 >= len)) {
                    {
                        dest[destOff2--] = src[srcOff2--];
                    }
                }
                ;
                return;
            }
        }
        len += srcOff;
        len -= 7;
        while ((srcOff < len)) {
            {
                let destOff2 = destOff + 1;
                let srcOff2 = srcOff + 1;
                dest[destOff] = src[srcOff];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                destOff = destOff2 + 1;
                srcOff = srcOff2 + 1;
                dest[destOff2] = src[srcOff2];
            }
        }
        ;
        len += 7;
        while ((srcOff < len)) {
            {
                dest[destOff++] = src[srcOff++];
            }
        }
        ;
    }
    static copy(src, srcOff, dest, destOff, len) {
        if (((src != null && src instanceof Array && (src.length == 0 || src[0] == null || (typeof src[0] === 'number'))) || src === null) && ((typeof srcOff === 'number') || srcOff === null) && ((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof destOff === 'number') || destOff === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copy$byte_A$int$byte_A$int$int(src, srcOff, dest, destOff, len);
        }
        else if (((src != null && src instanceof Array && (src.length == 0 || src[0] == null || (typeof src[0] === 'number'))) || src === null) && ((typeof srcOff === 'number') || srcOff === null) && ((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof destOff === 'number') || destOff === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copy$short_A$int$short_A$int$int(src, srcOff, dest, destOff, len);
        }
        else if (((src != null && src instanceof Array && (src.length == 0 || src[0] == null || (typeof src[0] === 'number'))) || src === null) && ((typeof srcOff === 'number') || srcOff === null) && ((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof destOff === 'number') || destOff === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copy$int_A$int$int_A$int$int(src, srcOff, dest, destOff, len);
        }
        else if (((src != null && src instanceof Array && (src.length == 0 || src[0] == null || (typeof src[0] === 'number'))) || src === null) && ((typeof srcOff === 'number') || srcOff === null) && ((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof destOff === 'number') || destOff === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copy$long_A$int$long_A$int$int(src, srcOff, dest, destOff, len);
        }
        else if (((src != null && src instanceof Array && (src.length == 0 || src[0] == null || (typeof src[0] === 'number'))) || src === null) && ((typeof srcOff === 'number') || srcOff === null) && ((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof destOff === 'number') || destOff === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copy$float_A$int$float_A$int$int(src, srcOff, dest, destOff, len);
        }
        else if (((src != null && src instanceof Array && (src.length == 0 || src[0] == null || (src[0] != null))) || src === null) && ((typeof srcOff === 'number') || srcOff === null) && ((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (dest[0] != null))) || dest === null) && ((typeof destOff === 'number') || destOff === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copy$java_lang_Object_A$int$java_lang_Object_A$int$int(src, srcOff, dest, destOff, len);
        }
        else
            throw new Error('invalid overload');
    }
    static copy$short_A$int$short_A$int$int(src, srcOff, dest, destOff, len) {
        if (src === dest) {
            if (srcOff === destOff) {
                return;
            }
            if (destOff > srcOff && destOff < srcOff + len) {
                len--;
                let srcOff2 = srcOff + len;
                let destOff2 = destOff + len;
                len = srcOff2 - len;
                len += 7;
                while ((srcOff2 >= len)) {
                    {
                        let destOff3 = destOff2 - 1;
                        let srcOff3 = srcOff2 - 1;
                        dest[destOff2] = src[srcOff2];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        destOff2 = destOff3 - 1;
                        srcOff2 = srcOff3 - 1;
                        dest[destOff3] = src[srcOff3];
                    }
                }
                ;
                len -= 7;
                while ((srcOff2 >= len)) {
                    {
                        dest[destOff2--] = src[srcOff2--];
                    }
                }
                ;
                return;
            }
        }
        len += srcOff;
        len -= 7;
        while ((srcOff < len)) {
            {
                let destOff2 = destOff + 1;
                let srcOff2 = srcOff + 1;
                dest[destOff] = src[srcOff];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                destOff = destOff2 + 1;
                srcOff = srcOff2 + 1;
                dest[destOff2] = src[srcOff2];
            }
        }
        ;
        len += 7;
        while ((srcOff < len)) {
            {
                dest[destOff++] = src[srcOff++];
            }
        }
        ;
    }
    static copy$int_A$int$int_A$int$int(src, srcOff, dest, destOff, len) {
        if (src === dest) {
            if (srcOff === destOff) {
                return;
            }
            if (destOff > srcOff && destOff < srcOff + len) {
                len--;
                let srcOff2 = srcOff + len;
                let destOff2 = destOff + len;
                len = srcOff2 - len;
                len += 7;
                while ((srcOff2 >= len)) {
                    {
                        let destOff3 = destOff2 - 1;
                        let srcOff3 = srcOff2 - 1;
                        dest[destOff2] = src[srcOff2];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        destOff2 = destOff3 - 1;
                        srcOff2 = srcOff3 - 1;
                        dest[destOff3] = src[srcOff3];
                    }
                }
                ;
                len -= 7;
                while ((srcOff2 >= len)) {
                    {
                        dest[destOff2--] = src[srcOff2--];
                    }
                }
                ;
                return;
            }
        }
        len += srcOff;
        len -= 7;
        while ((srcOff < len)) {
            {
                let destOff2 = destOff + 1;
                let srcOff2 = srcOff + 1;
                dest[destOff] = src[srcOff];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                destOff = destOff2 + 1;
                srcOff = srcOff2 + 1;
                dest[destOff2] = src[srcOff2];
            }
        }
        ;
        len += 7;
        while ((srcOff < len)) {
            {
                dest[destOff++] = src[srcOff++];
            }
        }
        ;
    }
    static copy$long_A$int$long_A$int$int(src, srcOff, dest, destOff, len) {
        if (src === dest) {
            if (srcOff === destOff) {
                return;
            }
            if (destOff > srcOff && destOff < srcOff + len) {
                len--;
                let srcOff2 = srcOff + len;
                let destOff2 = destOff + len;
                len = srcOff2 - len;
                len += 3;
                while ((srcOff2 >= len)) {
                    {
                        let destOff3 = destOff2 - 1;
                        let srcOff3 = srcOff2 - 1;
                        dest[destOff2] = src[srcOff2];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        destOff2 = destOff3 - 1;
                        srcOff2 = srcOff3 - 1;
                        dest[destOff3] = src[srcOff3];
                    }
                }
                ;
                len -= 3;
                while ((srcOff2 >= len)) {
                    {
                        dest[destOff2--] = src[srcOff2--];
                    }
                }
                ;
                return;
            }
        }
        len += srcOff;
        len -= 3;
        while ((srcOff < len)) {
            {
                let destOff2 = destOff + 1;
                let srcOff2 = srcOff + 1;
                dest[destOff] = src[srcOff];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                destOff = destOff2 + 1;
                srcOff = srcOff2 + 1;
                dest[destOff2] = src[srcOff2];
            }
        }
        ;
        len += 3;
        while ((srcOff < len)) {
            {
                dest[destOff++] = src[srcOff++];
            }
        }
        ;
    }
    static copy$float_A$int$float_A$int$int(src, srcOff, dest, destOff, len) {
        if (src === dest) {
            return;
        }
        len -= 7;
        while ((srcOff < len)) {
            {
                let destOff2 = destOff + 1;
                let srcOff2 = srcOff + 1;
                dest[destOff] = src[srcOff];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                destOff = destOff2 + 1;
                srcOff = srcOff2 + 1;
                dest[destOff2] = src[srcOff2];
            }
        }
        ;
        len += 7;
        while ((srcOff < len)) {
            {
                dest[destOff++] = src[srcOff++];
            }
        }
        ;
    }
    static copy$java_lang_Object_A$int$java_lang_Object_A$int$int(src, srcOff, dest, destOff, len) {
        if (src === dest) {
            if (srcOff === destOff) {
                return;
            }
            if (destOff > srcOff && destOff < srcOff + len) {
                len--;
                let srcOff2 = srcOff + len;
                let destOff2 = destOff + len;
                len = srcOff2 - len;
                len += 7;
                while ((srcOff2 >= len)) {
                    {
                        let destOff3 = destOff2 - 1;
                        let srcOff3 = srcOff2 - 1;
                        dest[destOff2] = src[srcOff2];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        dest[destOff3--] = src[srcOff3--];
                        destOff2 = destOff3 - 1;
                        srcOff2 = srcOff3 - 1;
                        dest[destOff3] = src[srcOff3];
                    }
                }
                ;
                len -= 7;
                while ((srcOff2 >= len)) {
                    {
                        dest[destOff2--] = src[srcOff2--];
                    }
                }
                ;
                return;
            }
        }
        len += srcOff;
        len -= 7;
        while ((srcOff < len)) {
            {
                let destOff2 = destOff + 1;
                let srcOff2 = srcOff + 1;
                dest[destOff] = src[srcOff];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                dest[destOff2++] = src[srcOff2++];
                destOff = destOff2 + 1;
                srcOff = srcOff2 + 1;
                dest[destOff2] = src[srcOff2];
            }
        }
        ;
        len += 7;
        while ((srcOff < len)) {
            {
                dest[destOff++] = src[srcOff++];
            }
        }
        ;
    }
    static clear(dest, off, len) {
        len = len - 7;
        while ((off < len)) {
            {
                let off2 = off + 1;
                dest[off] = 0;
                dest[off2++] = 0;
                dest[off2++] = 0;
                dest[off2++] = 0;
                dest[off2++] = 0;
                dest[off2++] = 0;
                dest[off2++] = 0;
                off = off2 + 1;
                dest[off2] = 0;
            }
        }
        ;
        len += 7;
        while ((off < len)) {
            {
                dest[off++] = 0;
            }
        }
        ;
    }
    static fill$short_A$int$int$short(dest, off, len, value) {
        len = len - 7;
        while ((off < len)) {
            {
                let off2 = off + 1;
                dest[off] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                off = off2 + 1;
                dest[off2] = value;
            }
        }
        ;
        len += 7;
        while ((off < len)) {
            {
                dest[off++] = value;
            }
        }
        ;
    }
    static fill(dest, off, len, value) {
        if (((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof off === 'number') || off === null) && ((typeof len === 'number') || len === null) && ((typeof value === 'number') || value === null)) {
            return ArrayUtils.fill$short_A$int$int$short(dest, off, len, value);
        }
        else if (((dest != null && dest instanceof Array && (dest.length == 0 || dest[0] == null || (typeof dest[0] === 'number'))) || dest === null) && ((typeof off === 'number') || off === null) && ((typeof len === 'number') || len === null) && ((typeof value === 'number') || value === null)) {
            return ArrayUtils.fill$int_A$int$int$int(dest, off, len, value);
        }
        else
            throw new Error('invalid overload');
    }
    static fill$int_A$int$int$int(dest, off, len, value) {
        len = off + len - 7;
        while ((off < len)) {
            {
                let off2 = off + 1;
                dest[off] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                dest[off2++] = value;
                off = off2 + 1;
                dest[off2] = value;
            }
        }
        ;
        len += 7;
        while ((off < len)) {
            {
                dest[off++] = value;
            }
        }
        ;
    }
    static sort$int_A$java_lang_Object_A(keys, values) {
        ArrayUtils.sort$int_A$java_lang_Object_A$int$int(keys, values, 0, keys.length - 1);
    }
    static sort$int_A$java_lang_Object_A$int$int(keys, values, lo, hi) {
        if (hi <= lo) {
            return;
        }
        const mid = ((lo + hi) / 2 | 0);
        let i = lo;
        const pivotKey = keys[mid];
        keys[mid] = keys[hi];
        keys[hi] = pivotKey;
        const pivotValue = values[mid];
        values[mid] = values[hi];
        values[hi] = pivotValue;
        for (let j = lo; j < hi; j++) {
            {
                if (pivotKey + (j & 1) > keys[j]) {
                    const key = keys[j];
                    keys[j] = keys[i];
                    keys[i] = key;
                    const value = values[j];
                    values[j] = values[i];
                    values[i++] = value;
                }
            }
            ;
        }
        keys[hi] = keys[i];
        keys[i] = pivotKey;
        values[hi] = values[i];
        values[i] = pivotValue;
        ArrayUtils.sort$int_A$java_lang_Object_A$int$int(keys, values, lo, i - 1);
        ArrayUtils.sort$int_A$java_lang_Object_A$int$int(keys, values, i + 1, hi);
    }
    static sort(keys, values, lo, hi) {
        if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (values[0] != null))) || values === null) && ((typeof lo === 'number') || lo === null) && ((typeof hi === 'number') || hi === null)) {
            return ArrayUtils.sort$int_A$java_lang_Object_A$int$int(keys, values, lo, hi);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'string'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (typeof values[0] === 'number'))) || values === null) && ((typeof lo === 'number') || lo === null) && ((typeof hi === 'number') || hi === null)) {
            return ArrayUtils.sort$java_lang_String_A$short_A$int$int(keys, values, lo, hi);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (values[0] != null))) || values === null) && ((typeof lo === 'number') || lo === null) && ((typeof hi === 'number') || hi === null)) {
            return ArrayUtils.sort$long_A$java_lang_Object_A$int$int(keys, values, lo, hi);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (typeof values[0] === 'number'))) || values === null) && ((typeof lo === 'number') || lo === null) && ((typeof hi === 'number') || hi === null)) {
            return ArrayUtils.sort$long_A$int_A$int$int(keys, values, lo, hi);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (typeof values[0] === 'number'))) || values === null) && ((typeof lo === 'number') || lo === null) && ((typeof hi === 'number') || hi === null)) {
            return ArrayUtils.sort$int_A$int_A$int$int(keys, values, lo, hi);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (values[0] != null))) || values === null) && lo === undefined && hi === undefined) {
            return ArrayUtils.sort$int_A$java_lang_Object_A(keys, values);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'string'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (typeof values[0] === 'number'))) || values === null) && lo === undefined && hi === undefined) {
            return ArrayUtils.sort$java_lang_String_A$short_A(keys, values);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (values[0] != null))) || values === null) && lo === undefined && hi === undefined) {
            return ArrayUtils.sort$long_A$java_lang_Object_A(keys, values);
        }
        else if (((keys != null && keys instanceof Array && (keys.length == 0 || keys[0] == null || (typeof keys[0] === 'number'))) || keys === null) && ((values != null && values instanceof Array && (values.length == 0 || values[0] == null || (typeof values[0] === 'number'))) || values === null) && lo === undefined && hi === undefined) {
            return ArrayUtils.sort$long_A$int_A(keys, values);
        }
        else
            throw new Error('invalid overload');
    }
    static sort$java_lang_String_A$short_A(keys, values) {
        ArrayUtils.sort$java_lang_String_A$short_A$int$int(keys, values, 0, keys.length - 1);
    }
    static sort$java_lang_String_A$short_A$int$int(keys, values, lo, hi) {
        if (hi <= lo) {
            return;
        }
        const mid = ((lo + hi) / 2 | 0);
        let i = lo;
        const pivotKey = keys[mid];
        keys[mid] = keys[hi];
        keys[hi] = pivotKey;
        const pivotValue = values[mid];
        values[mid] = values[hi];
        values[hi] = pivotValue;
        for (let j = lo; j < hi; j++) {
            {
                if (pivotKey == null || keys[j] != null && /* compareTo */ keys[j].localeCompare(pivotKey) < (j & 1)) {
                    const key = keys[j];
                    keys[j] = keys[i];
                    keys[i] = key;
                    const value = values[j];
                    values[j] = values[i];
                    values[i++] = value;
                }
            }
            ;
        }
        keys[hi] = keys[i];
        keys[i] = pivotKey;
        values[hi] = values[i];
        values[i] = pivotValue;
        ArrayUtils.sort$java_lang_String_A$short_A$int$int(keys, values, lo, i - 1);
        ArrayUtils.sort$java_lang_String_A$short_A$int$int(keys, values, i + 1, hi);
    }
    static copyOfNullable$short_A(array) {
        if (array == null) {
            return null;
        }
        else {
            const copy = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(array.length);
            ArrayUtils.copy$short_A$int$short_A$int$int(array, 0, copy, 0, array.length);
            return copy;
        }
    }
    static copyOfNullable(array) {
        if (((array != null && array instanceof Array && (array.length == 0 || array[0] == null || (typeof array[0] === 'number'))) || array === null)) {
            return ArrayUtils.copyOfNullable$short_A(array);
        }
        else if (((array != null && array instanceof Array && (array.length == 0 || array[0] == null || (typeof array[0] === 'number'))) || array === null)) {
            return ArrayUtils.copyOfNullable$int_A(array);
        }
        else
            throw new Error('invalid overload');
    }
    static copyOf$short_A$int(array, len) {
        const copy = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(len);
        ArrayUtils.copy$short_A$int$short_A$int$int(array, 0, copy, 0, len);
        return copy;
    }
    static copyOf(array, len) {
        if (((array != null && array instanceof Array && (array.length == 0 || array[0] == null || (typeof array[0] === 'number'))) || array === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copyOf$short_A$int(array, len);
        }
        else if (((array != null && array instanceof Array && (array.length == 0 || array[0] == null || (typeof array[0] === 'number'))) || array === null) && ((typeof len === 'number') || len === null)) {
            return ArrayUtils.copyOf$float_A$int(array, len);
        }
        else
            throw new Error('invalid overload');
    }
    static copyOfNullable$int_A(array) {
        if (array == null) {
            return null;
        }
        else {
            const copy = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(array.length);
            ArrayUtils.copy$int_A$int$int_A$int$int(array, 0, copy, 0, array.length);
            return copy;
        }
    }
    static copyOf$float_A$int(array, len) {
        const copy = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(len);
        ArrayUtils.copy$float_A$int$float_A$int$int(array, 0, copy, 0, len);
        return copy;
    }
    /*private*/ static sort$long_A$java_lang_Object_A$int$int(keys, values, lo, hi) {
        if (lo >= hi) {
            return;
        }
        const mid = ((hi + lo) / 2 | 0);
        let i = lo;
        const pivotKey = keys[mid];
        keys[mid] = keys[hi];
        keys[hi] = pivotKey;
        const pivotValue = values[mid];
        values[mid] = values[hi];
        values[hi] = pivotValue;
        for (let j = lo; j < hi; j++) {
            {
                if (keys[j] < (n => n < 0 ? Math.ceil(n) : Math.floor(n))((j & 1)) + pivotKey) {
                    const key = keys[j];
                    keys[j] = keys[i];
                    keys[i] = key;
                    const value = values[j];
                    values[j] = values[i];
                    values[i++] = value;
                }
            }
            ;
        }
        keys[hi] = keys[i];
        keys[i] = pivotKey;
        values[hi] = values[i];
        values[i] = pivotValue;
        ArrayUtils.sort$long_A$java_lang_Object_A$int$int(keys, values, lo, i - 1);
        ArrayUtils.sort$long_A$java_lang_Object_A$int$int(keys, values, i + 1, hi);
    }
    static sort$long_A$java_lang_Object_A(keys, values) {
        ArrayUtils.sort$long_A$java_lang_Object_A$int$int(keys, values, 0, keys.length - 1);
    }
    static sort$long_A$int_A$int$int(keys, values, lo, hi) {
        if (hi <= lo) {
            return;
        }
        const mid = ((hi + lo) / 2 | 0);
        let i = lo;
        const pivotKey = keys[mid];
        keys[mid] = keys[hi];
        keys[hi] = pivotKey;
        const pivotValue = values[mid];
        values[mid] = values[hi];
        values[hi] = pivotValue;
        for (let j = lo; j < hi; j++) {
            {
                if (keys[j] < (n => n < 0 ? Math.ceil(n) : Math.floor(n))((j & 1)) + pivotKey) {
                    const key = keys[j];
                    keys[j] = keys[i];
                    keys[i] = key;
                    const value = values[j];
                    values[j] = values[i];
                    values[i++] = value;
                }
            }
            ;
        }
        keys[hi] = keys[i];
        keys[i] = pivotKey;
        values[hi] = values[i];
        values[i] = pivotValue;
        ArrayUtils.sort$long_A$int_A$int$int(keys, values, lo, i - 1);
        ArrayUtils.sort$long_A$int_A$int$int(keys, values, i + 1, hi);
    }
    static sort$long_A$int_A(keys, values) {
        ArrayUtils.sort$long_A$int_A$int$int(keys, values, 0, keys.length - 1);
    }
    static fillRange(dest, start, end, value) {
        end--;
        const end2 = end - 7;
        let start2 = start - 1;
        while ((start2 < end2)) {
            {
                start = start2 + 1;
                dest[start] = value;
                start++;
                dest[start] = value;
                start++;
                dest[start] = value;
                start++;
                dest[start] = value;
                start++;
                dest[start] = value;
                start++;
                dest[start] = value;
                start++;
                dest[start] = value;
                start2 = start + 1;
                dest[start2] = value;
            }
        }
        ;
        while ((start2 < end)) {
            {
                start2++;
                dest[start2] = value;
            }
        }
        ;
    }
    static sort$int_A$int_A$int$int(keys, values, lo, hi) {
        if (lo >= hi) {
            return;
        }
        let i = lo;
        const mid = ((hi + lo) / 2 | 0);
        const pivotKey = keys[mid];
        keys[mid] = keys[hi];
        keys[hi] = pivotKey;
        const pivotValue = values[mid];
        values[mid] = values[hi];
        values[hi] = pivotValue;
        for (let j = lo; j < hi; j++) {
            {
                if (keys[j] > (j & 1) + pivotKey) {
                    const key = keys[j];
                    keys[j] = keys[i];
                    keys[i] = key;
                    const value = values[j];
                    values[j] = values[i];
                    values[i++] = value;
                }
            }
            ;
        }
        keys[hi] = keys[i];
        keys[i] = pivotKey;
        values[hi] = values[i];
        values[i] = pivotValue;
        ArrayUtils.sort$int_A$int_A$int$int(keys, values, lo, i - 1);
        ArrayUtils.sort$int_A$int_A$int$int(keys, values, i + 1, hi);
    }
}
ArrayUtils["__class"] = "ArrayUtils";
class BufferPool {
    static smallBuffers_$LI$() { if (BufferPool.smallBuffers == null) {
        BufferPool.smallBuffers = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(1000);
    } return BufferPool.smallBuffers; }
    static mediumBuffers_$LI$() { if (BufferPool.mediumBuffers == null) {
        BufferPool.mediumBuffers = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(250);
    } return BufferPool.mediumBuffers; }
    static largeBuffers_$LI$() { if (BufferPool.largeBuffers == null) {
        BufferPool.largeBuffers = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(50);
    } return BufferPool.largeBuffers; }
    static allocate(size) {
        if (size === 100 && BufferPool.smallBufferCount > 0) {
            const bytes = BufferPool.smallBuffers_$LI$()[--BufferPool.smallBufferCount];
            BufferPool.smallBuffers_$LI$()[BufferPool.smallBufferCount] = null;
            return bytes;
        }
        else if (size === 5000 && BufferPool.mediumBufferCount > 0) {
            const bytes = BufferPool.mediumBuffers_$LI$()[--BufferPool.mediumBufferCount];
            BufferPool.mediumBuffers_$LI$()[BufferPool.mediumBufferCount] = null;
            return bytes;
        }
        else if (size === 30000 && BufferPool.largeBufferCount > 0) {
            const bytes = BufferPool.largeBuffers_$LI$()[--BufferPool.largeBufferCount];
            BufferPool.largeBuffers_$LI$()[BufferPool.largeBufferCount] = null;
            return bytes;
        }
        else {
            return (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(size);
        }
    }
}
BufferPool.smallBufferCount = 0;
BufferPool.mediumBufferCount = 0;
BufferPool.largeBufferCount = 0;
BufferPool["__class"] = "BufferPool";
class ColorImageCache {
    constructor(capacity, height, width) {
        this.singleRow = -1;
        this.size = 0;
        this.recentlyUsed = new LinkedList();
        this.invalid = false;
        if (this.capacity === undefined) {
            this.capacity = 0;
        }
        if (this.height === undefined) {
            this.height = 0;
        }
        if (this.entries === undefined) {
            this.entries = null;
        }
        if (this.pixels === undefined) {
            this.pixels = null;
        }
        this.capacity = capacity;
        this.height = height;
        this.entries = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(this.height);
        this.pixels = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([this.capacity, 3, width]);
    }
    clear() {
        for (let i = 0; i < this.capacity; i++) {
            {
                this.pixels[i][0] = null;
                this.pixels[i][1] = null;
                this.pixels[i][2] = null;
                this.pixels[i] = null;
            }
            ;
        }
        this.pixels = null;
        this.entries = null;
        this.recentlyUsed.clear();
        this.recentlyUsed = null;
    }
    get$() {
        if (this.capacity !== this.height) {
            throw Object.defineProperty(new Error("Can only retrieve a full image cache"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
        }
        for (let row = 0; row < this.capacity; row++) {
            {
                this.entries[row] = ColorImageCacheEntry.VALID_$LI$();
            }
            ;
        }
        return this.pixels;
    }
    get$int(row) {
        if (this.height === this.capacity) {
            this.invalid = this.entries[row] == null;
            this.entries[row] = ColorImageCacheEntry.VALID_$LI$();
            return this.pixels[row];
        }
        else if (this.capacity === 1) {
            this.invalid = row !== this.singleRow;
            this.singleRow = row;
            return this.pixels[0];
        }
        else {
            let entry = this.entries[row];
            if (entry == null) {
                this.invalid = true;
                if (this.capacity <= this.size) {
                    const lruEntry = this.recentlyUsed.tail();
                    entry = new ColorImageCacheEntry(row, lruEntry.index);
                    this.entries[lruEntry.row] = null;
                    lruEntry.unlink();
                }
                else {
                    entry = new ColorImageCacheEntry(row, this.size);
                    this.size++;
                }
                this.entries[row] = entry;
            }
            else {
                this.invalid = false;
            }
            this.recentlyUsed.addHead(entry);
            return this.pixels[entry.index];
        }
    }
    get(row) {
        if (((typeof row === 'number') || row === null)) {
            return this.get$int(row);
        }
        else if (row === undefined) {
            return this.get$();
        }
        else
            throw new Error('invalid overload');
    }
}
ColorImageCache["__class"] = "ColorImageCache";
class HashTable {
    constructor(bucketCount) {
        if (this.searchCursor === undefined) {
            this.searchCursor = null;
        }
        if (this.searchKey === undefined) {
            this.searchKey = 0;
        }
        if (this.iteratorCursor === undefined) {
            this.iteratorCursor = null;
        }
        this.iteratorBucket = 0;
        if (this.buckets === undefined) {
            this.buckets = null;
        }
        if (this.bucketCount === undefined) {
            this.bucketCount = 0;
        }
        this.buckets = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(bucketCount);
        this.bucketCount = bucketCount;
        for (let i = 0; i < bucketCount; i++) {
            {
                const sentinel = this.buckets[i] = new Node();
                sentinel.prev = sentinel;
                sentinel.next = sentinel;
            }
            ;
        }
    }
    getBucketCount() {
        return this.bucketCount;
    }
    put(key, value) {
        if (value.prev != null) {
            value.unlink();
        }
        const sentinel = this.buckets[((key & (n => n < 0 ? Math.ceil(n) : Math.floor(n))((this.bucketCount - 1))) | 0)];
        value.key = key;
        value.next = sentinel;
        value.prev = sentinel.prev;
        value.prev.next = value;
        value.next.prev = value;
    }
    size() {
        let size = 0;
        for (let i = 0; i < this.bucketCount; i++) {
            {
                const sentinel = this.buckets[i];
                for (let node = sentinel.next; node !== sentinel; node = node.next) {
                    {
                        size++;
                    }
                    ;
                }
            }
            ;
        }
        return size;
    }
    head() {
        this.iteratorBucket = 0;
        return this.next();
    }
    next() {
        if (this.iteratorBucket > 0 && this.buckets[this.iteratorBucket - 1] !== this.iteratorCursor) {
            const node = this.iteratorCursor;
            this.iteratorCursor = node.next;
            return node;
        }
        let node;
        do {
            {
                if (this.iteratorBucket >= this.bucketCount) {
                    return null;
                }
                node = this.buckets[this.iteratorBucket++].next;
            }
        } while ((node === this.buckets[this.iteratorBucket - 1]));
        this.iteratorCursor = node.next;
        return node;
    }
    get(key) {
        this.searchKey = key;
        const sentinel = this.buckets[((key & (n => n < 0 ? Math.ceil(n) : Math.floor(n))((this.bucketCount - 1))) | 0)];
        for (this.searchCursor = sentinel.next; this.searchCursor !== sentinel; this.searchCursor = this.searchCursor.next) {
            {
                if (this.searchCursor.key === key) {
                    const value = this.searchCursor;
                    this.searchCursor = this.searchCursor.next;
                    return value;
                }
            }
            ;
        }
        this.searchCursor = null;
        return null;
    }
    toArray(array) {
        let size = 0;
        for (let i = 0; i < this.bucketCount; i++) {
            {
                const sentinel = this.buckets[i];
                for (let node = sentinel.next; node !== sentinel; node = node.next) {
                    {
                        array[size++] = node;
                    }
                    ;
                }
            }
            ;
        }
        return size;
    }
    nextWithKey() {
        if (this.searchCursor == null) {
            return null;
        }
        const sentinel = this.buckets[(((n => n < 0 ? Math.ceil(n) : Math.floor(n))((this.bucketCount - 1)) & this.searchKey) | 0)];
        while ((sentinel !== this.searchCursor)) {
            {
                if (this.searchKey === this.searchCursor.key) {
                    const node = this.searchCursor;
                    this.searchCursor = this.searchCursor.next;
                    return node;
                }
                this.searchCursor = this.searchCursor.next;
            }
        }
        ;
        this.searchCursor = null;
        return null;
    }
    clear() {
        for (let i = 0; i < this.bucketCount; i++) {
            {
                const sentinel = this.buckets[i];
                while ((true)) {
                    {
                        const node = sentinel.next;
                        if (node === sentinel) {
                            break;
                        }
                        node.unlink();
                    }
                }
                ;
            }
            ;
        }
        this.iteratorCursor = null;
        this.searchCursor = null;
    }
}
HashTable["__class"] = "HashTable";
class IntUtils {
    static clp2(v) {
        v--;
        v |= v >>> 1;
        v |= v >>> 2;
        v |= v >>> 4;
        v |= v >>> 8;
        v |= v >>> 16;
        return v + 1;
    }
    static flp2(v) {
        let v2 = v >>> 1;
        v2 |= v2 >>> 1;
        v2 |= v2 >>> 2;
        v2 |= v2 >>> 4;
        v2 |= v2 >>> 8;
        v2 |= v2 >>> 16;
        return v & ~v2;
    }
    static isPowerOfTwo(v) {
        return v === (v & -v);
    }
    static bitCount(v) {
        let bits = 0;
        if (v < 0 || v >= 65536) {
            v >>>= 16;
            bits += 16;
        }
        if (v >= 256) {
            v >>>= 8;
            bits += 8;
        }
        if (v >= 16) {
            v >>>= 4;
            bits += 4;
        }
        if (v >= 4) {
            bits += 2;
            v >>>= 2;
        }
        if (v >= 1) {
            bits++;
            v >>>= 1;
        }
        return bits + v;
    }
    static bitCountFast(v) {
        v = (v >>> 1 & 1431655765) + (v & 1431655765);
        v = (v & 858993459) + (v >>> 2 & -1288490189);
        v = (v >>> 4) + v & 252645135;
        v += v >>> 8;
        v += v >>> 16;
        return v & 255;
    }
    static signum(v) {
        if (v > 0) {
            return 1;
        }
        else if (v < 0) {
            return -1;
        }
        else {
            return 0;
        }
    }
    static toString(v) {
        return v < 0 ? /* toString */ ('' + (v)) : IntUtils.toStringInternal(v);
    }
    /*private*/ static toStringInternal(v) {
        if (v < 0) {
            return /* toString */ ('' + (v));
        }
        let len = 2;
        for (let temp = (v / 10 | 0); temp !== 0; temp = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(temp / 10)) {
            {
                len++;
            }
            ;
        }
        const chars = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(len);
        chars[0] = '+';
        for (let i = len - 1; i > 0; i--) {
            {
                const prevValue = v;
                v = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(v / 10);
                const digit = prevValue - v * 10;
                if (digit >= 10) {
                    chars[i] = String.fromCharCode((digit + 87));
                }
                else {
                    chars[i] = String.fromCharCode((digit + 48));
                }
            }
            ;
        }
        return chars.join('');
    }
    static bitReverse(__in, len) {
        let out = 0;
        while ((len > 0)) {
            {
                out = __in & 1 | out << 1;
                __in >>>= 1;
                len--;
            }
        }
        ;
        return out;
    }
    static pow(a, b) {
        let result = 1;
        while ((b > 1)) {
            {
                if ((b & 1) !== 0) {
                    result *= a;
                }
                b >>= 1;
                a *= a;
            }
        }
        ;
        if (b === 1) {
            return a * result;
        }
        else {
            return result;
        }
    }
    static clamp(value, min, max) {
        if (value < min) {
            return min;
        }
        if (value > max) {
            return max;
        }
        return value;
    }
}
IntUtils["__class"] = "IntUtils";
class JsTextureProvider {
    getTexture(id) {
        throw Object.defineProperty(new Error("implement from javavscript"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    getSprite(id) {
        throw Object.defineProperty(new Error("implement from javavscript"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
}
JsTextureProvider["__class"] = "JsTextureProvider";
class LinkedList {
    constructor() {
        if (this.cursor === undefined) {
            this.cursor = null;
        }
        this.sentinel = new Node();
        this.sentinel.next = this.sentinel;
        this.sentinel.prev = this.sentinel;
    }
    static insertBefore(node, position) {
        if (node.prev != null) {
            node.unlink();
        }
        node.next = position;
        node.prev = position.prev;
        node.prev.next = node;
        node.next.prev = node;
    }
    clear() {
        while ((true)) {
            {
                const node = this.sentinel.next;
                if (this.sentinel === node) {
                    this.cursor = null;
                    return;
                }
                node.unlink();
            }
        }
        ;
    }
    addHead(node) {
        if (node.prev != null) {
            node.unlink();
        }
        node.prev = this.sentinel;
        node.next = this.sentinel.next;
        node.prev.next = node;
        node.next.prev = node;
    }
    removeHead() {
        const node = this.sentinel.next;
        if (node === this.sentinel) {
            return null;
        }
        else {
            node.unlink();
            return node;
        }
    }
    isEmpty() {
        return this.sentinel.next === this.sentinel;
    }
    head() {
        const node = this.sentinel.next;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        else {
            this.cursor = node.next;
            return node;
        }
    }
    addTail(node) {
        if (node.prev != null) {
            node.unlink();
        }
        node.prev = this.sentinel.prev;
        node.next = this.sentinel;
        node.prev.next = node;
        node.next.prev = node;
    }
    tail() {
        const node = this.sentinel.prev;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        else {
            this.cursor = node.prev;
            return node;
        }
    }
    prev() {
        const node = this.cursor;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        else {
            this.cursor = node.prev;
            return node;
        }
    }
    next() {
        const node = this.cursor;
        if (this.sentinel === node) {
            this.cursor = null;
            return null;
        }
        else {
            this.cursor = node.next;
            return node;
        }
    }
}
LinkedList["__class"] = "LinkedList";
class LruHashTable {
    constructor(capacity) {
        this.aClass4_Sub3_18 = new SecondaryNode();
        this.queue = new SecondaryLinkedList();
        if (this.available === undefined) {
            this.available = 0;
        }
        if (this.capacity === undefined) {
            this.capacity = 0;
        }
        if (this.table === undefined) {
            this.table = null;
        }
        this.available = capacity;
        let bucketCount;
        for (bucketCount = 1; bucketCount + bucketCount < capacity; bucketCount += bucketCount) {
            {
            }
            ;
        }
        this.capacity = capacity;
        this.table = new HashTable(bucketCount);
    }
    head() {
        return this.table.head();
    }
    put(key, value) {
        if (this.available === 0) {
            const first = this.queue.removeHead();
            first.unlink();
            first.unlinkSecondary();
            if (this.aClass4_Sub3_18 === first) {
                const second = this.queue.removeHead();
                second.unlink();
                second.unlinkSecondary();
            }
        }
        else {
            this.available--;
        }
        this.table.put(key, value);
        this.queue.addTail(value);
    }
    get(key) {
        const value = this.table.get(key);
        if (value != null) {
            this.queue.addTail(value);
        }
        return value;
    }
    next() {
        return this.table.next();
    }
    clear() {
        this.queue.clear();
        this.table.clear();
        this.aClass4_Sub3_18 = new SecondaryNode();
        this.available = this.capacity;
    }
}
LruHashTable["__class"] = "LruHashTable";
class MergedStatics {
    static sub10_method283(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
        if (arg8 === arg4 && arg2 === arg7 && arg5 === arg6 && arg1 === arg0) {
            MergedStatics.sub9_method280(arg0, arg8, arg2, arg3, arg6);
            return;
        }
        let local36 = arg8;
        let local38 = arg2;
        const local42 = arg8 * 3;
        const local46 = arg2 * 3;
        const local50 = arg4 * 3;
        const local54 = arg5 * 3;
        const local58 = arg7 * 3;
        const local62 = arg1 * 3;
        const local72 = local50 + arg6 - arg8 - local54;
        const local81 = local58 + arg0 - local62 - arg2;
        const local92 = local54 + local42 - local50 - local50;
        const local103 = local62 + local46 - local58 - local58;
        const local108 = local58 - local46;
        const local113 = local50 - local42;
        for (let local115 = 128; local115 <= 4096; local115 += 128) {
            {
                const local126 = local115 * local115 >> 12;
                const local132 = local115 * local126 >> 12;
                const local136 = local132 * local72;
                const local140 = local126 * local92;
                const local144 = local113 * local115;
                const local148 = local103 * local126;
                const local158 = (local144 + local140 + local136 >> 12) + arg8;
                const local162 = local81 * local132;
                const local166 = local108 * local115;
                const local176 = (local166 + local162 + local148 >> 12) + arg2;
                MergedStatics.sub9_method280(local176, local36, local38, arg3, local158);
                local36 = local158;
                local38 = local176;
            }
            ;
        }
    }
    static sub22_method4693(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
        if (MergedStatics.sub2_anInt902 <= arg8 && arg8 <= MergedStatics.sub3_anInt2553 && MergedStatics.sub2_anInt902 <= arg0 && MergedStatics.sub3_anInt2553 >= arg0 && MergedStatics.sub2_anInt902 <= arg3 && MergedStatics.sub3_anInt2553 >= arg3 && MergedStatics.sub2_anInt902 <= arg4 && arg4 <= MergedStatics.sub3_anInt2553 && arg5 >= MergedStatics.sub4_anInt3086 && arg5 <= MergedStatics.sub5_anInt4230 && arg1 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg1 && arg7 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg7 && MergedStatics.sub4_anInt3086 <= arg6 && MergedStatics.sub5_anInt4230 >= arg6) {
            MergedStatics.sub10_method283(arg6, arg7, arg5, arg2, arg0, arg3, arg4, arg1, arg8);
        }
        else {
            MergedStatics.sub31_method3662(arg8, arg7, arg4, arg0, arg1, arg5, arg6, arg2, arg3);
        }
    }
    static sub9_method280(arg0, arg1, arg2, arg3, arg4) {
        let local10 = arg0 - arg2;
        let local15 = arg4 - arg1;
        if (local15 === 0) {
            if (local10 !== 0) {
                MergedStatics.sub10_method306(arg1, arg3, arg0, arg2);
            }
        }
        else if (local10 === 0) {
            MergedStatics.sub20_method1975(arg1, arg4, arg3, arg2);
        }
        else {
            if (local15 < 0) {
                local15 = -local15;
            }
            if (local10 < 0) {
                local10 = -local10;
            }
            const local70 = local10 > local15;
            if (local70) {
                const local74 = arg1;
                arg1 = arg2;
                arg2 = local74;
                const local80 = arg4;
                arg4 = arg0;
                arg0 = local80;
            }
            if (arg4 < arg1) {
                const local93 = arg1;
                arg1 = arg4;
                const local97 = arg2;
                arg2 = arg0;
                arg0 = local97;
                arg4 = local93;
            }
            let local105 = arg2;
            const local110 = arg4 - arg1;
            let local115 = arg0 - arg2;
            const local126 = arg0 > arg2 ? 1 : -1;
            if (local115 < 0) {
                local115 = -local115;
            }
            let local137 = -(local110 >> 1);
            if (local70) {
                for (let local141 = arg1; local141 <= arg4; local141++) {
                    {
                        local137 += local115;
                        MergedStatics.sub5_anIntArrayArray36[local141][local105] = arg3;
                        if (local137 > 0) {
                            local105 += local126;
                            local137 -= local110;
                        }
                    }
                    ;
                }
            }
            else {
                for (let local172 = arg1; local172 <= arg4; local172++) {
                    {
                        local137 += local115;
                        MergedStatics.sub5_anIntArrayArray36[local105][local172] = arg3;
                        if (local137 > 0) {
                            local105 += local126;
                            local137 -= local110;
                        }
                    }
                    ;
                }
            }
        }
    }
    static sub10_method306(arg0, arg1, arg2, arg3) {
        if (arg2 >= arg3) {
            for (let local10 = arg3; local10 < arg2; local10++) {
                {
                    MergedStatics.sub5_anIntArrayArray36[local10][arg0] = arg1;
                }
                ;
            }
        }
        else {
            for (let local30 = arg2; local30 < arg3; local30++) {
                {
                    MergedStatics.sub5_anIntArrayArray36[local30][arg0] = arg1;
                }
                ;
            }
        }
    }
    static sub20_method1975(arg0, arg1, arg2, arg3) {
        if (arg1 >= arg0) {
            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg3], arg0, arg1, arg2);
        }
        else {
            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg3], arg1, arg0, arg2);
        }
    }
    static sub31_method3662(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
        if (arg3 === arg0 && arg4 === arg5 && arg8 === arg2 && arg1 === arg6) {
            MergedStatics.sub32_method4022(arg5, arg6, arg7, arg0, arg2);
            return;
        }
        let local32 = arg0;
        let local34 = arg5;
        const local38 = arg0 * 3;
        const local42 = arg4 * 3;
        const local46 = arg3 * 3;
        const local50 = arg8 * 3;
        const local61 = arg2 + local46 - arg0 - local50;
        const local65 = arg5 * 3;
        const local75 = local38 + local50 - local46 - local46;
        const local79 = arg1 * 3;
        const local90 = local79 + local65 - local42 - local42;
        const local100 = local42 + arg6 - arg5 - local79;
        const local104 = local46 - local38;
        const local108 = local42 - local65;
        for (let local110 = 128; local110 <= 4096; local110 += 128) {
            {
                const local119 = local110 * local110 >> 12;
                const local123 = local119 * local75;
                const local129 = local110 * local119 >> 12;
                const local133 = local129 * local61;
                const local137 = local108 * local110;
                const local141 = local90 * local119;
                const local145 = local100 * local129;
                const local149 = local104 * local110;
                const local159 = (local149 + local123 + local133 >> 12) + arg0;
                const local170 = (local137 + local145 + local141 >> 12) + arg5;
                MergedStatics.sub32_method4022(local34, local170, arg7, local32, local159);
                local34 = local170;
                local32 = local159;
            }
            ;
        }
    }
    static sub32_method4022(arg0, arg1, arg2, arg3, arg4) {
        const local18 = arg4 - arg3;
        const local23 = arg1 - arg0;
        if (local18 === 0) {
            if (local23 !== 0) {
                MergedStatics.sub20_method1930(arg3, arg0, arg1, arg2);
            }
        }
        else if (local23 === 0) {
            MergedStatics.sub13_method1015(arg3, arg4, arg2, arg0);
        }
        else {
            const local55 = ((local23 << 12) / local18 | 0);
            const local64 = arg0 - (arg3 * local55 >> 12);
            let local76;
            let local78;
            if (arg3 < MergedStatics.sub2_anInt902) {
                local78 = local64 + (MergedStatics.sub2_anInt902 * local55 >> 12);
                local76 = MergedStatics.sub2_anInt902;
            }
            else if (MergedStatics.sub3_anInt2553 >= arg3) {
                local76 = arg3;
                local78 = arg0;
            }
            else {
                local76 = MergedStatics.sub3_anInt2553;
                local78 = (MergedStatics.sub3_anInt2553 * local55 >> 12) + local64;
            }
            let local115;
            let local117;
            if (arg4 < MergedStatics.sub2_anInt902) {
                local115 = MergedStatics.sub2_anInt902;
                local117 = local64 + (MergedStatics.sub2_anInt902 * local55 >> 12);
            }
            else if (arg4 <= MergedStatics.sub3_anInt2553) {
                local115 = arg4;
                local117 = arg1;
            }
            else {
                local115 = MergedStatics.sub3_anInt2553;
                local117 = (local55 * MergedStatics.sub3_anInt2553 >> 12) + local64;
            }
            if (MergedStatics.sub4_anInt3086 > local117) {
                local115 = ((MergedStatics.sub4_anInt3086 - local64 << 12) / local55 | 0);
                local117 = MergedStatics.sub4_anInt3086;
            }
            else if (MergedStatics.sub5_anInt4230 < local117) {
                local115 = ((MergedStatics.sub5_anInt4230 - local64 << 12) / local55 | 0);
                local117 = MergedStatics.sub5_anInt4230;
            }
            if (MergedStatics.sub4_anInt3086 > local78) {
                local76 = ((MergedStatics.sub4_anInt3086 - local64 << 12) / local55 | 0);
                local78 = MergedStatics.sub4_anInt3086;
            }
            else if (local78 > MergedStatics.sub5_anInt4230) {
                local78 = MergedStatics.sub5_anInt4230;
                local76 = ((MergedStatics.sub5_anInt4230 - local64 << 12) / local55 | 0);
            }
            MergedStatics.sub9_method280(local117, local76, local78, arg2, local115);
        }
    }
    static sub20_method1930(arg0, arg1, arg2, arg3) {
        if (MergedStatics.sub2_anInt902 <= arg0 && MergedStatics.sub3_anInt2553 >= arg0) {
            arg1 = IntUtils.clamp(arg1, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
            arg2 = IntUtils.clamp(arg2, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
            MergedStatics.sub10_method306(arg0, arg3, arg2, arg1);
        }
    }
    static sub13_method1015(arg0, arg1, arg2, arg3) {
        if (MergedStatics.sub4_anInt3086 <= arg3 && arg3 <= MergedStatics.sub5_anInt4230) {
            arg0 = IntUtils.clamp(arg0, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            arg1 = IntUtils.clamp(arg1, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            MergedStatics.sub20_method1975(arg0, arg1, arg2, arg3);
        }
    }
    static sub36_method4566(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
        if (arg0 >= MergedStatics.sub2_anInt902 && arg5 <= MergedStatics.sub3_anInt2553 && MergedStatics.sub4_anInt3086 <= arg6 && arg4 <= MergedStatics.sub5_anInt4230) {
            MergedStatics.sub9_method758(arg1, arg5, arg6, arg0, arg4, arg2, arg3);
        }
        else {
            MergedStatics.sub22_method2190(arg4, arg3, arg2, arg1, arg0, arg5, arg6);
        }
    }
    static sub9_method758(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
        const local6 = arg2 + arg6;
        const local14 = arg4 - arg6;
        const local18 = arg3 + arg6;
        const local23 = arg1 - arg6;
        for (let local25 = arg2; local25 < local6; local25++) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local25], arg3, arg1, arg0);
            }
            ;
        }
        for (let local55 = arg4; local55 > local14; local55--) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local55], arg3, arg1, arg0);
            }
            ;
        }
        for (let local75 = local6; local75 <= local14; local75++) {
            {
                const local86 = MergedStatics.sub5_anIntArrayArray36[local75];
                ArrayUtils.fillRange(local86, arg3, local18, arg0);
                ArrayUtils.fillRange(local86, local18, local23, arg5);
                ArrayUtils.fillRange(local86, local23, arg1, arg0);
            }
            ;
        }
    }
    static sub22_method2190(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
        const local11 = IntUtils.clamp(arg6, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local22 = IntUtils.clamp(arg0, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local28 = IntUtils.clamp(arg4, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local34 = IntUtils.clamp(arg5, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local43 = IntUtils.clamp(arg6 + arg1, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local52 = IntUtils.clamp(arg0 - arg1, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        for (let local54 = local11; local54 < local43; local54++) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local54], local28, local34, arg3);
            }
            ;
        }
        for (let local74 = local22; local74 > local52; local74--) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local74], local28, local34, arg3);
            }
            ;
        }
        const local97 = IntUtils.clamp(arg4 + arg1, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local106 = IntUtils.clamp(arg5 - arg1, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        for (let local108 = local43; local108 <= local52; local108++) {
            {
                const local119 = MergedStatics.sub5_anIntArrayArray36[local108];
                ArrayUtils.fillRange(local119, local28, local97, arg3);
                ArrayUtils.fillRange(local119, local97, local106, arg2);
                ArrayUtils.fillRange(local119, local106, local34, arg3);
            }
            ;
        }
    }
    static sub32_method3997(arg0, arg1, arg2, arg3, arg4, arg5) {
        if (arg0 >= MergedStatics.sub2_anInt902 && MergedStatics.sub3_anInt2553 >= arg5 && arg2 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg4) {
            if (arg3 === 1) {
                MergedStatics.sub27_method4706(arg1, arg0, arg5, arg2, arg4);
            }
            else {
                MergedStatics.sub14_method1200(arg1, arg0, arg4, arg5, arg3, arg2);
            }
        }
        else if (arg3 === 1) {
            MergedStatics.sub27_method4241(arg5, arg4, arg2, arg1, arg0);
        }
        else {
            MergedStatics.sub31_method3781(arg5, arg1, arg3, arg0, arg2, arg4);
        }
    }
    static sub31_method3781(arg0, arg1, arg2, arg3, arg4, arg5) {
        const local17 = IntUtils.clamp(arg4, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local23 = IntUtils.clamp(arg5, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local29 = IntUtils.clamp(arg3, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local35 = IntUtils.clamp(arg0, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local43 = IntUtils.clamp(arg2 + arg4, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local52 = IntUtils.clamp(arg5 - arg2, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        for (let local54 = local17; local54 < local43; local54++) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local54], local29, local35, arg1);
            }
            ;
        }
        for (let local70 = local23; local70 > local52; local70--) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local70], local29, local35, arg1);
            }
            ;
        }
        const local97 = IntUtils.clamp(arg3 + arg2, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local106 = IntUtils.clamp(arg0 - arg2, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        for (let local108 = local43; local108 <= local52; local108++) {
            {
                const local119 = MergedStatics.sub5_anIntArrayArray36[local108];
                ArrayUtils.fillRange(local119, local29, local97, arg1);
                ArrayUtils.fillRange(local119, local106, local35, arg1);
            }
            ;
        }
    }
    static sub27_method4241(arg0, arg1, arg2, arg3, arg4) {
        if (MergedStatics.sub5_anInt4230 < arg2 || MergedStatics.sub4_anInt3086 > arg1) {
            return;
        }
        let local23;
        if (MergedStatics.sub2_anInt902 > arg4) {
            arg4 = MergedStatics.sub2_anInt902;
            local23 = false;
        }
        else if (arg4 > MergedStatics.sub3_anInt2553) {
            arg4 = MergedStatics.sub3_anInt2553;
            local23 = false;
        }
        else {
            local23 = true;
        }
        let local51;
        if (arg0 < MergedStatics.sub2_anInt902) {
            arg0 = MergedStatics.sub2_anInt902;
            local51 = false;
        }
        else if (MergedStatics.sub3_anInt2553 < arg0) {
            arg0 = MergedStatics.sub3_anInt2553;
            local51 = false;
        }
        else {
            local51 = true;
        }
        let local71;
        if (MergedStatics.sub4_anInt3086 <= arg2) {
            local71 = arg2 + 1;
            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg2], arg4, arg0, arg3);
        }
        else {
            local71 = MergedStatics.sub4_anInt3086;
        }
        let local89;
        if (MergedStatics.sub5_anInt4230 < arg1) {
            local89 = MergedStatics.sub5_anInt4230;
        }
        else {
            local89 = arg1 - 1;
            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg1], arg4, arg0, arg3);
        }
        if (local23 && local51) {
            for (let local106 = local71; local106 <= local89; local106++) {
                {
                    const local113 = MergedStatics.sub5_anIntArrayArray36[local106];
                    local113[arg4] = local113[arg0] = arg3;
                }
                ;
            }
        }
        else if (local23) {
            for (let local149 = local71; local149 <= local89; local149++) {
                {
                    MergedStatics.sub5_anIntArrayArray36[local149][arg4] = arg3;
                }
                ;
            }
        }
        else if (local51) {
            for (let local133 = local71; local133 <= local89; local133++) {
                {
                    MergedStatics.sub5_anIntArrayArray36[local133][arg0] = arg3;
                }
                ;
            }
        }
    }
    static sub27_method4706(arg0, arg1, arg2, arg3, arg4) {
        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg3++], arg1, arg2, arg0);
        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg4--], arg1, arg2, arg0);
        for (let local31 = arg3; local31 <= arg4; local31++) {
            {
                const local42 = MergedStatics.sub5_anIntArrayArray36[local31];
                local42[arg1] = local42[arg2] = arg0;
            }
            ;
        }
    }
    static sub14_method1200(arg0, arg1, arg2, arg3, arg4, arg5) {
        const local10 = arg4 + arg5;
        const local18 = arg2 - arg4;
        const local22 = arg4 + arg1;
        for (let local24 = arg5; local24 < local10; local24++) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local24], arg1, arg3, arg0);
            }
            ;
        }
        for (let local44 = arg2; local44 > local18; local44--) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local44], arg1, arg3, arg0);
            }
            ;
        }
        const local66 = arg3 - arg4;
        for (let local68 = local10; local68 <= local18; local68++) {
            {
                const local79 = MergedStatics.sub5_anIntArrayArray36[local68];
                ArrayUtils.fillRange(local79, arg1, local22, arg0);
                ArrayUtils.fillRange(local79, local66, arg3, arg0);
            }
            ;
        }
    }
    static sub29_method3429(arg0, arg1, arg2, arg3, arg4) {
        if (MergedStatics.sub2_anInt902 <= arg0 && arg2 <= MergedStatics.sub3_anInt2553 && MergedStatics.sub4_anInt3086 <= arg3 && arg1 <= MergedStatics.sub5_anInt4230) {
            MergedStatics.sub15_method1477(arg3, arg0, arg1, arg4, arg2);
        }
        else {
            MergedStatics.sub22_method4701(arg0, arg2, arg3, arg4, arg1);
        }
    }
    static sub15_method1477(arg0, arg1, arg2, arg3, arg4) {
        for (let local6 = arg0; local6 <= arg2; local6++) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local6], arg1, arg4, arg3);
            }
            ;
        }
    }
    static sub22_method4701(arg0, arg1, arg2, arg3, arg4) {
        const local11 = IntUtils.clamp(arg2, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local17 = IntUtils.clamp(arg4, MergedStatics.sub4_anInt3086, MergedStatics.sub5_anInt4230);
        const local23 = IntUtils.clamp(arg0, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local29 = IntUtils.clamp(arg1, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        for (let local31 = local11; local31 <= local17; local31++) {
            {
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local31], local23, local29, arg3);
            }
            ;
        }
    }
    static sub18_method1745(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
        if (arg0 === arg6) {
            MergedStatics.sub8_method100(arg0, arg3, arg5, arg1, arg2, arg4);
        }
        else if (arg2 - arg0 >= MergedStatics.sub2_anInt902 && MergedStatics.sub3_anInt2553 >= arg0 + arg2 && arg5 - arg6 >= MergedStatics.sub4_anInt3086 && arg6 + arg5 <= MergedStatics.sub5_anInt4230) {
            MergedStatics.sub10_method388(arg2, arg4, arg3, arg5, arg0, arg1, arg6);
        }
        else {
            MergedStatics.sub32_method4031(arg1, arg3, arg2, arg6, arg5, arg0, arg4);
        }
    }
    static sub32_method4031(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
        let local3 = 0;
        const local7 = arg3 - arg6;
        let local9 = arg3;
        let local11 = 0;
        const local16 = arg5 - arg6;
        const local20 = arg5 * arg5;
        const local28 = arg3 * arg3;
        const local32 = local16 * local16;
        const local36 = local28 << 1;
        const local40 = local7 * local7;
        const local44 = local20 << 1;
        const local48 = local40 << 1;
        const local52 = local32 << 1;
        const local56 = arg3 << 1;
        const local60 = local7 << 1;
        let local69 = local36 + (1 - local56) * local20;
        let local78 = local28 - (local56 - 1) * local44;
        let local87 = local32 * (1 - local60) + local48;
        const local91 = local20 << 2;
        let local104 = local40 - local52 * (local60 - 1);
        const local108 = local28 << 2;
        const local112 = local32 << 2;
        const local116 = local40 << 2;
        let local120 = local36 * 3;
        let local124 = local48 * 3;
        let local130 = local44 * (local56 - 3);
        let local132 = local108;
        let local138 = (local60 - 3) * local52;
        let local144 = local91 * (arg3 - 1);
        let local146 = local116;
        let local152 = (local7 - 1) * local112;
        if (arg4 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg4) {
            const local166 = MergedStatics.sub5_anIntArrayArray36[arg4];
            const local177 = IntUtils.clamp(arg2 - arg5, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local185 = IntUtils.clamp(arg2 + arg5, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local193 = IntUtils.clamp(arg2 - local16, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local203 = IntUtils.clamp(arg2 + local16, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            ArrayUtils.fillRange(local166, local177, local193, arg1);
            ArrayUtils.fillRange(local166, local193, local203, arg0);
            ArrayUtils.fillRange(local166, local203, local185, arg1);
        }
        while ((local9 > 0)) {
            {
                if (local69 < 0) {
                    while ((local69 < 0)) {
                        {
                            local69 += local120;
                            local3++;
                            local120 += local108;
                            local78 += local132;
                            local132 += local108;
                        }
                    }
                    ;
                }
                if (local78 < 0) {
                    local3++;
                    local69 += local120;
                    local120 += local108;
                    local78 += local132;
                    local132 += local108;
                }
                const local281 = local7 >= local9;
                local78 += -local130;
                local9--;
                if (local281) {
                    if (local87 < 0) {
                        while ((local87 < 0)) {
                            {
                                local87 += local124;
                                local104 += local146;
                                local124 += local116;
                                local146 += local116;
                                local11++;
                            }
                        }
                        ;
                    }
                    if (local104 < 0) {
                        local87 += local124;
                        local124 += local116;
                        local104 += local146;
                        local146 += local116;
                        local11++;
                    }
                    local104 += -local138;
                    local138 -= local112;
                    local87 += -local152;
                    local152 -= local112;
                }
                local69 += -local144;
                const local363 = local9 + arg4;
                const local367 = arg4 - local9;
                local144 -= local91;
                local130 -= local91;
                if (local363 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= local367) {
                    const local389 = IntUtils.clamp(local3 + arg2, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                    const local398 = IntUtils.clamp(arg2 - local3, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                    if (local281) {
                        const local409 = IntUtils.clamp(arg2 + local11, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                        const local418 = IntUtils.clamp(arg2 - local11, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                        if (MergedStatics.sub4_anInt3086 <= local367) {
                            const local426 = MergedStatics.sub5_anIntArrayArray36[local367];
                            ArrayUtils.fillRange(local426, local398, local418, arg1);
                            ArrayUtils.fillRange(local426, local418, local409, arg0);
                            ArrayUtils.fillRange(local426, local409, local389, arg1);
                        }
                        if (MergedStatics.sub5_anInt4230 >= local363) {
                            const local456 = MergedStatics.sub5_anIntArrayArray36[local363];
                            ArrayUtils.fillRange(local456, local398, local418, arg1);
                            ArrayUtils.fillRange(local456, local418, local409, arg0);
                            ArrayUtils.fillRange(local456, local409, local389, arg1);
                        }
                    }
                    else {
                        if (local367 >= MergedStatics.sub4_anInt3086) {
                            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local367], local398, local389, arg1);
                        }
                        if (MergedStatics.sub5_anInt4230 >= local363) {
                            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local363], local398, local389, arg1);
                        }
                    }
                }
            }
        }
        ;
    }
    static sub10_method388(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
        let local7 = 0;
        let local9 = arg6;
        const local14 = arg4 - arg1;
        let local16 = 0;
        const local21 = arg6 - arg1;
        const local25 = arg4 * arg4;
        const local29 = arg6 * arg6;
        const local33 = local14 * local14;
        const local37 = local21 * local21;
        const local41 = local29 << 1;
        const local45 = local37 << 1;
        const local49 = local25 << 1;
        const local53 = local33 << 1;
        const local57 = arg6 << 1;
        const local61 = local21 << 1;
        let local71 = local25 * (1 - local57) + local41;
        let local80 = local29 - local49 * (local57 - 1);
        let local89 = local45 + (1 - local61) * local33;
        let local98 = local37 - local53 * (local61 - 1);
        const local102 = local25 << 2;
        const local106 = local29 << 2;
        const local110 = local37 << 2;
        const local114 = local33 << 2;
        let local118 = local41 * 3;
        let local124 = local49 * (local57 - 3);
        let local128 = local45 * 3;
        let local130 = local106;
        let local136 = (local61 - 3) * local53;
        let local138 = local110;
        let local144 = (arg6 - 1) * local102;
        let local150 = local114 * (local21 - 1);
        const local154 = MergedStatics.sub5_anIntArrayArray36[arg3];
        ArrayUtils.fillRange(local154, arg0 - arg4, arg0 - local14, arg2);
        ArrayUtils.fillRange(local154, arg0 - local14, local14 + arg0, arg5);
        ArrayUtils.fillRange(local154, local14 + arg0, arg0 + arg4, arg2);
        while ((local9 > 0)) {
            {
                if (local71 < 0) {
                    while ((local71 < 0)) {
                        {
                            local71 += local118;
                            local118 += local106;
                            local7++;
                            local80 += local130;
                            local130 += local106;
                        }
                    }
                    ;
                }
                if (local80 < 0) {
                    local71 += local118;
                    local80 += local130;
                    local118 += local106;
                    local7++;
                    local130 += local106;
                }
                local71 += -local144;
                const local251 = arg0 - local7;
                const local258 = local21 >= local9;
                const local263 = arg0 + local7;
                local144 -= local102;
                local9--;
                local80 += -local124;
                const local277 = local9 + arg3;
                local124 -= local102;
                if (local258) {
                    if (local89 < 0) {
                        while ((local89 < 0)) {
                            {
                                local16++;
                                local98 += local138;
                                local89 += local128;
                                local138 += local110;
                                local128 += local110;
                            }
                        }
                        ;
                    }
                    if (local98 < 0) {
                        local89 += local128;
                        local128 += local110;
                        local16++;
                        local98 += local138;
                        local138 += local110;
                    }
                    local98 += -local136;
                    local89 += -local150;
                    local150 -= local114;
                    local136 -= local114;
                }
                const local352 = arg3 - local9;
                if (local258) {
                    const local358 = arg0 - local16;
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local352], local251, local358, arg2);
                    const local371 = arg0 + local16;
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local352], local358, local371, arg5);
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local352], local371, local263, arg2);
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local277], local251, local358, arg2);
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local277], local358, local371, arg5);
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local277], local371, local263, arg2);
                }
                else {
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local352], local251, local263, arg2);
                    ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local277], local251, local263, arg2);
                }
            }
        }
        ;
    }
    static sub8_method100(arg0, arg1, arg2, arg3, arg4, arg5) {
        if (MergedStatics.sub2_anInt902 <= arg4 - arg0 && arg0 + arg4 <= MergedStatics.sub3_anInt2553 && arg2 - arg0 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg0 + arg2) {
            MergedStatics.sub10_method896(arg5, arg1, arg0, arg3, arg4, arg2);
        }
        else {
            MergedStatics.sub14_method1082(arg0, arg5, arg4, arg1, arg3, arg2);
        }
    }
    static sub32_method3885(arg0) {
        if (MergedStatics.sub7_anIntArray678 == null || MergedStatics.sub7_anIntArray678.length < arg0) {
            MergedStatics.sub7_anIntArray678 = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(arg0);
        }
    }
    static sub14_method1082(arg0, arg1, arg2, arg3, arg4, arg5) {
        MergedStatics.sub32_method3885(arg0);
        let local9 = arg0 - arg1;
        let local15 = arg0;
        let local17 = 0;
        let local20 = -arg0;
        if (local9 < 0) {
            local9 = 0;
        }
        let local29 = local9;
        if (MergedStatics.sub4_anInt3086 <= arg5 && arg5 <= MergedStatics.sub5_anInt4230) {
            const local40 = MergedStatics.sub5_anIntArrayArray36[arg5];
            const local48 = IntUtils.clamp(arg2 - arg0, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local56 = IntUtils.clamp(arg0 + arg2, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local67 = IntUtils.clamp(arg2 - local9, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local77 = IntUtils.clamp(arg2 + local9, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            ArrayUtils.fillRange(local40, local48, local67, arg3);
            ArrayUtils.fillRange(local40, local67, local77, arg4);
            ArrayUtils.fillRange(local40, local77, local56, arg3);
        }
        let local98 = -local9;
        let local100 = -1;
        let local102 = -1;
        while ((local17 < local15)) {
            {
                local100 += 2;
                local98 += local100;
                local102 += 2;
                if (local98 >= 0 && local29 >= 1) {
                    local29--;
                    local98 -= local29 << 1;
                    MergedStatics.sub7_anIntArray678[local29] = local17;
                }
                local17++;
                local20 += local102;
                if (local20 >= 0) {
                    local15--;
                    local20 -= local15 << 1;
                    const local154 = arg5 - local15;
                    const local159 = arg5 + local15;
                    if (MergedStatics.sub4_anInt3086 <= local159 && local154 <= MergedStatics.sub5_anInt4230) {
                        if (local15 >= local9) {
                            const local186 = IntUtils.clamp(arg2 + local17, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            const local194 = IntUtils.clamp(arg2 - local17, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            if (MergedStatics.sub5_anInt4230 >= local159) {
                                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local159], local194, local186, arg3);
                            }
                            if (local154 >= MergedStatics.sub4_anInt3086) {
                                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local154], local194, local186, arg3);
                            }
                        }
                        else {
                            const local226 = MergedStatics.sub7_anIntArray678[local15];
                            const local237 = IntUtils.clamp(arg2 + local17, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            const local245 = IntUtils.clamp(arg2 - local17, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            const local254 = IntUtils.clamp(arg2 + local226, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            const local262 = IntUtils.clamp(arg2 - local226, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            if (MergedStatics.sub5_anInt4230 >= local159) {
                                const local274 = MergedStatics.sub5_anIntArrayArray36[local159];
                                ArrayUtils.fillRange(local274, local245, local262, arg3);
                                ArrayUtils.fillRange(local274, local262, local254, arg4);
                                ArrayUtils.fillRange(local274, local254, local237, arg3);
                            }
                            if (MergedStatics.sub4_anInt3086 <= local154) {
                                const local300 = MergedStatics.sub5_anIntArrayArray36[local154];
                                ArrayUtils.fillRange(local300, local245, local262, arg3);
                                ArrayUtils.fillRange(local300, local262, local254, arg4);
                                ArrayUtils.fillRange(local300, local254, local237, arg3);
                            }
                        }
                    }
                }
                const local322 = arg5 + local17;
                const local327 = arg5 - local17;
                if (MergedStatics.sub4_anInt3086 <= local322 && MergedStatics.sub5_anInt4230 >= local327) {
                    const local337 = local15 + arg2;
                    const local342 = arg2 - local15;
                    if (local337 >= MergedStatics.sub2_anInt902 && MergedStatics.sub3_anInt2553 >= local342) {
                        const local359 = IntUtils.clamp(local337, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                        const local365 = IntUtils.clamp(local342, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                        if (local17 >= local9) {
                            if (MergedStatics.sub5_anInt4230 >= local322) {
                                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local322], local365, local359, arg3);
                            }
                            if (MergedStatics.sub4_anInt3086 <= local327) {
                                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local327], local365, local359, arg3);
                            }
                        }
                        else {
                            const local415 = local29 >= local17 ? local29 : MergedStatics.sub7_anIntArray678[local17];
                            const local424 = IntUtils.clamp(arg2 + local415, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            const local432 = IntUtils.clamp(arg2 - local415, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                            if (MergedStatics.sub5_anInt4230 >= local322) {
                                const local440 = MergedStatics.sub5_anIntArrayArray36[local322];
                                ArrayUtils.fillRange(local440, local365, local432, arg3);
                                ArrayUtils.fillRange(local440, local432, local424, arg4);
                                ArrayUtils.fillRange(local440, local424, local359, arg3);
                            }
                            if (MergedStatics.sub4_anInt3086 <= local327) {
                                const local469 = MergedStatics.sub5_anIntArrayArray36[local327];
                                ArrayUtils.fillRange(local469, local365, local432, arg3);
                                ArrayUtils.fillRange(local469, local432, local424, arg4);
                                ArrayUtils.fillRange(local469, local424, local359, arg3);
                            }
                        }
                    }
                }
            }
        }
        ;
    }
    static sub10_method896(arg0, arg1, arg2, arg3, arg4, arg5) {
        MergedStatics.sub32_method3885(arg2);
        let local10 = 0;
        let local13 = -arg2;
        let local17 = arg2 - arg0;
        let local19 = arg2;
        let local21 = -1;
        let local23 = -1;
        const local27 = MergedStatics.sub5_anIntArrayArray36[arg5];
        if (local17 < 0) {
            local17 = 0;
        }
        let local34 = local17;
        const local39 = arg4 - local17;
        ArrayUtils.fillRange(local27, arg4 - arg2, local39, arg1);
        const local57 = local17 + arg4;
        let local60 = -local17;
        ArrayUtils.fillRange(local27, local39, local57, arg3);
        ArrayUtils.fillRange(local27, local57, arg4 + arg2, arg1);
        while ((local19 > local10)) {
            {
                local23 += 2;
                local13 += local23;
                local21 += 2;
                local60 += local21;
                if (local60 >= 0 && local34 >= 1) {
                    MergedStatics.sub7_anIntArray678[local34] = local10;
                    local34--;
                    local60 -= local34 << 1;
                }
                local10++;
                if (local13 >= 0) {
                    local19--;
                    if (local19 >= local17) {
                        const local126 = MergedStatics.sub5_anIntArrayArray36[arg5 + local19];
                        const local131 = arg4 + local10;
                        const local138 = MergedStatics.sub5_anIntArrayArray36[arg5 - local19];
                        const local143 = arg4 - local10;
                        ArrayUtils.fillRange(local126, local143, local131, arg1);
                        ArrayUtils.fillRange(local138, local143, local131, arg1);
                    }
                    else {
                        const local163 = MergedStatics.sub5_anIntArrayArray36[local19 + arg5];
                        const local167 = MergedStatics.sub7_anIntArray678[local19];
                        const local174 = MergedStatics.sub5_anIntArrayArray36[arg5 - local19];
                        const local178 = local10 + arg4;
                        const local182 = arg4 - local167;
                        const local186 = local167 + arg4;
                        const local191 = arg4 - local10;
                        ArrayUtils.fillRange(local163, local191, local182, arg1);
                        ArrayUtils.fillRange(local163, local182, local186, arg3);
                        ArrayUtils.fillRange(local163, local186, local178, arg1);
                        ArrayUtils.fillRange(local174, local191, local182, arg1);
                        ArrayUtils.fillRange(local174, local182, local186, arg3);
                        ArrayUtils.fillRange(local174, local186, local178, arg1);
                    }
                    local13 -= local19 << 1;
                }
                const local240 = MergedStatics.sub5_anIntArrayArray36[arg5 + local10];
                const local247 = MergedStatics.sub5_anIntArrayArray36[arg5 - local10];
                const local251 = local19 + arg4;
                const local256 = arg4 - local19;
                if (local17 <= local10) {
                    ArrayUtils.fillRange(local240, local256, local251, arg1);
                    ArrayUtils.fillRange(local247, local256, local251, arg1);
                }
                else {
                    const local286 = local10 > local34 ? MergedStatics.sub7_anIntArray678[local10] : local34;
                    const local290 = local286 + arg4;
                    const local294 = arg4 - local286;
                    ArrayUtils.fillRange(local240, local256, local294, arg1);
                    ArrayUtils.fillRange(local240, local294, local290, arg3);
                    ArrayUtils.fillRange(local240, local290, local251, arg1);
                    ArrayUtils.fillRange(local247, local256, local294, arg1);
                    ArrayUtils.fillRange(local247, local294, local290, arg3);
                    ArrayUtils.fillRange(local247, local290, local251, arg1);
                }
            }
        }
        ;
    }
    static sub28_method3323(arg0, arg1, arg2, arg3, arg4) {
        if (arg0 === arg4) {
            MergedStatics.sub32_method4032(arg4, arg2, arg3, arg1);
        }
        else if (MergedStatics.sub2_anInt902 <= arg1 - arg4 && MergedStatics.sub3_anInt2553 >= arg1 + arg4 && arg3 - arg0 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg3 + arg0) {
            MergedStatics.sub19_method4379(arg0, arg1, arg2, arg3, arg4);
        }
        else {
            MergedStatics.sub26_method4814(arg3, arg0, arg2, arg4, arg1);
        }
    }
    static sub32_method4032(arg0, arg1, arg2, arg3) {
        if (arg3 - arg0 >= MergedStatics.sub2_anInt902 && MergedStatics.sub3_anInt2553 >= arg3 + arg0 && arg2 - arg0 >= MergedStatics.sub4_anInt3086 && arg2 + arg0 <= MergedStatics.sub5_anInt4230) {
            MergedStatics.sub11_method565(arg2, arg3, arg0, arg1);
        }
        else {
            MergedStatics.sub29_method3463(arg2, arg3, arg0, arg1);
        }
    }
    static sub29_method3463(arg0, arg1, arg2, arg3) {
        let local3 = 0;
        let local14 = arg2;
        let local16 = -1;
        let local19 = -arg2;
        const local27 = IntUtils.clamp(arg2 + arg1, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        const local35 = IntUtils.clamp(arg1 - arg2, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg0], local35, local27, arg3);
        while ((local14 > local3)) {
            {
                local16 += 2;
                local19 += local16;
                if (local19 > 0) {
                    local14--;
                    local19 -= local14 << 1;
                    const local72 = arg0 - local14;
                    const local76 = local14 + arg0;
                    if (local76 >= MergedStatics.sub4_anInt3086 && local72 <= MergedStatics.sub5_anInt4230) {
                        const local98 = IntUtils.clamp(arg1 + local3, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                        const local106 = IntUtils.clamp(arg1 - local3, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                        if (MergedStatics.sub5_anInt4230 >= local76) {
                            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local76], local106, local98, arg3);
                        }
                        if (MergedStatics.sub4_anInt3086 <= local72) {
                            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local72], local106, local98, arg3);
                        }
                    }
                }
                local3++;
                const local138 = arg0 - local3;
                const local142 = arg0 + local3;
                if (MergedStatics.sub4_anInt3086 <= local142 && local138 <= MergedStatics.sub5_anInt4230) {
                    const local166 = IntUtils.clamp(arg1 + local14, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                    const local174 = IntUtils.clamp(arg1 - local14, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                    if (local142 <= MergedStatics.sub5_anInt4230) {
                        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local142], local174, local166, arg3);
                    }
                    if (MergedStatics.sub4_anInt3086 <= local138) {
                        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local138], local174, local166, arg3);
                    }
                }
            }
        }
        ;
    }
    static sub11_method565(arg0, arg1, arg2, arg3) {
        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg0], arg1 - arg2, arg2 + arg1, arg3);
        let local20 = 0;
        let local33 = arg2;
        let local36 = -arg2;
        let local38 = -1;
        while ((local33 > local20)) {
            {
                local38 += 2;
                local20++;
                local36 += local38;
                if (local36 >= 0) {
                    local33--;
                    local36 -= local33 << 1;
                    const local69 = MergedStatics.sub5_anIntArrayArray36[arg0 - local33];
                    const local76 = MergedStatics.sub5_anIntArrayArray36[arg0 + local33];
                    const local80 = arg1 - local20;
                    const local84 = arg1 + local20;
                    ArrayUtils.fillRange(local76, local80, local84, arg3);
                    ArrayUtils.fillRange(local69, local80, local84, arg3);
                }
                const local101 = arg1 + local33;
                const local106 = arg1 - local33;
                const local112 = MergedStatics.sub5_anIntArrayArray36[arg0 + local20];
                const local118 = MergedStatics.sub5_anIntArrayArray36[arg0 - local20];
                ArrayUtils.fillRange(local112, local106, local101, arg3);
                ArrayUtils.fillRange(local118, local106, local101, arg3);
            }
        }
        ;
    }
    static sub19_method4379(arg0, arg1, arg2, arg3, arg4) {
        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg3], arg1 - arg4, arg4 + arg1, arg2);
        let local20 = 0;
        let local22 = arg0;
        const local26 = arg4 * arg4;
        const local34 = arg0 * arg0;
        const local38 = local26 << 1;
        const local42 = arg0 << 1;
        const local46 = local34 << 1;
        let local54 = local34 - local38 * (local42 - 1);
        let local63 = local46 + (1 - local42) * local26;
        const local67 = local26 << 2;
        let local75 = local46 * 3;
        let local83 = local38 * ((arg0 << 1) - 3);
        const local87 = local34 << 2;
        let local93 = local87;
        let local99 = (arg0 - 1) * local67;
        while ((local22 > 0)) {
            {
                if (local63 < 0) {
                    while ((local63 < 0)) {
                        {
                            local20++;
                            local63 += local75;
                            local54 += local93;
                            local93 += local87;
                            local75 += local87;
                        }
                    }
                    ;
                }
                local22--;
                if (local54 < 0) {
                    local54 += local93;
                    local63 += local75;
                    local75 += local87;
                    local93 += local87;
                    local20++;
                }
                const local150 = arg3 - local22;
                local63 += -local99;
                const local159 = arg1 + local20;
                local99 -= local67;
                const local167 = local22 + arg3;
                local54 += -local83;
                local83 -= local67;
                const local181 = arg1 - local20;
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local150], local181, local159, arg2);
                ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local167], local181, local159, arg2);
            }
        }
        ;
    }
    static sub26_method4814(arg0, arg1, arg2, arg3, arg4) {
        let local7 = arg1;
        let local9 = 0;
        const local21 = arg1 * arg1;
        const local25 = arg3 * arg3;
        const local29 = local25 << 1;
        const local33 = local21 << 1;
        const local37 = arg1 << 1;
        let local46 = local21 - (local37 - 1) * local29;
        let local56 = (1 - local37) * local25 + local33;
        const local60 = local25 << 2;
        const local64 = local21 << 2;
        let local72 = local33 * 3;
        let local78 = local64;
        let local86 = ((arg1 << 1) - 3) * local29;
        if (arg0 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= arg0) {
            const local109 = IntUtils.clamp(arg4 + arg3, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            const local117 = IntUtils.clamp(arg4 - arg3, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
            ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[arg0], local117, local109, arg2);
        }
        let local131 = local60 * (arg1 - 1);
        while ((local7 > 0)) {
            {
                if (local56 < 0) {
                    while ((local56 < 0)) {
                        {
                            local56 += local72;
                            local46 += local78;
                            local78 += local64;
                            local72 += local64;
                            local9++;
                        }
                    }
                    ;
                }
                local7--;
                if (local46 < 0) {
                    local46 += local78;
                    local78 += local64;
                    local56 += local72;
                    local9++;
                    local72 += local64;
                }
                local56 += -local131;
                const local198 = arg0 - local7;
                local46 += -local86;
                local131 -= local60;
                const local211 = local7 + arg0;
                local86 -= local60;
                if (local211 >= MergedStatics.sub4_anInt3086 && MergedStatics.sub5_anInt4230 >= local198) {
                    const local229 = IntUtils.clamp(local9 + arg4, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                    const local237 = IntUtils.clamp(arg4 - local9, MergedStatics.sub2_anInt902, MergedStatics.sub3_anInt2553);
                    if (MergedStatics.sub4_anInt3086 <= local198) {
                        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local198], local237, local229, arg2);
                    }
                    if (local211 <= MergedStatics.sub5_anInt4230) {
                        ArrayUtils.fillRange(MergedStatics.sub5_anIntArrayArray36[local211], local237, local229, arg2);
                    }
                }
            }
        }
        ;
    }
    static sub18_method4374(arg0, arg1) {
        MergedStatics.sub5_anInt4230 = arg0;
        MergedStatics.sub3_anInt2553 = arg1;
        MergedStatics.sub4_anInt3086 = 0;
        MergedStatics.sub2_anInt902 = 0;
    }
    static sub35_method4335(arg0) {
        MergedStatics.sub5_anIntArrayArray36 = arg0;
    }
}
MergedStatics.sub5_anInt4230 = 100;
MergedStatics.sub4_anInt3086 = 0;
MergedStatics.sub7_anIntArray678 = null;
MergedStatics.sub3_anInt2553 = 100;
MergedStatics.sub2_anInt902 = 0;
MergedStatics.sub5_anIntArrayArray36 = null;
MergedStatics["__class"] = "MergedStatics";
class Node {
    constructor() {
        if (this.prev === undefined) {
            this.prev = null;
        }
        if (this.next === undefined) {
            this.next = null;
        }
        if (this.key === undefined) {
            this.key = 0;
        }
    }
    isLinked() {
        return this.prev != null;
    }
    unlink() {
        if (this.prev != null) {
            this.prev.next = this.next;
            this.next.prev = this.prev;
            this.prev = null;
            this.next = null;
        }
    }
}
Node["__class"] = "Node";
/**
 * Construct a random generator with the given {@code seed} as the initial
 * state.
 *
 * @param {number} seed the seed that will determine the initial state of this random
 * number generator.
 * @see #setSeed
 * @class
 */
class Random {
    constructor(seed) {
        if (((typeof seed === 'number') || seed === null)) {
            let __args = arguments;
            if (this.nextNextGaussian === undefined) {
                this.nextNextGaussian = 0;
            }
            if (this.seedhi === undefined) {
                this.seedhi = 0;
            }
            if (this.seedlo === undefined) {
                this.seedlo = 0;
            }
            this.haveNextNextGaussian = false;
            this.setSeed$long(seed);
        }
        else if (seed === undefined) {
            let __args = arguments;
            if (this.nextNextGaussian === undefined) {
                this.nextNextGaussian = 0;
            }
            if (this.seedhi === undefined) {
                this.seedhi = 0;
            }
            if (this.seedlo === undefined) {
                this.seedlo = 0;
            }
            this.haveNextNextGaussian = false;
            const seed = Random.uniqueSeed++ + Date.now();
            const hi = (Math.floor(seed * Random.twoToTheMinus24) | 0) & 16777215;
            const lo = ((seed - (hi * Random.twoToThe24)) | 0);
            this.setSeed$int$int(hi, lo);
        }
        else
            throw new Error('invalid overload');
    }
    static __static_initialize() { if (!Random.__static_initialized) {
        Random.__static_initialized = true;
        Random.__static_initializer_0();
    } }
    static twoToTheXMinus24_$LI$() { Random.__static_initialize(); if (Random.twoToTheXMinus24 == null) {
        Random.twoToTheXMinus24 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(25);
    } return Random.twoToTheXMinus24; }
    static twoToTheXMinus48_$LI$() { Random.__static_initialize(); if (Random.twoToTheXMinus48 == null) {
        Random.twoToTheXMinus48 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(33);
    } return Random.twoToTheXMinus48; }
    static __static_initializer_0() {
        let twoToTheXMinus48Tmp = 1.52587890625E-5;
        for (let i = 32; i >= 0; i--) {
            {
                Random.twoToTheXMinus48_$LI$()[i] = twoToTheXMinus48Tmp;
                twoToTheXMinus48Tmp *= 0.5;
            }
            ;
        }
        let twoToTheXMinus24Tmp = 1.0;
        for (let i = 24; i >= 0; i--) {
            {
                Random.twoToTheXMinus24_$LI$()[i] = twoToTheXMinus24Tmp;
                twoToTheXMinus24Tmp *= 0.5;
            }
            ;
        }
    }
    /**
     * Returns the next pseudo-random, uniformly distributed {@code boolean} value
     * generated by this generator.
     *
     * @return {boolean} a pseudo-random, uniformly distributed boolean value.
     */
    nextBoolean() {
        return this.nextInternal(1) !== 0;
    }
    /**
     * Modifies the {@code byte} array by a random sequence of {@code byte}s
     * generated by this random number generator.
     *
     * @param {byte[]} buf non-null array to contain the new random {@code byte}s.
     * @see #next
     */
    nextBytes(buf) {
        let rand = 0;
        let count = 0;
        let loop = 0;
        while ((count < buf.length)) {
            {
                if (loop === 0) {
                    rand = (this.nextInternal(32) | 0);
                    loop = 3;
                }
                else {
                    loop--;
                }
                buf[count++] = (rand | 0);
                rand >>= 8;
            }
        }
        ;
    }
    /**
     * Generates a normally distributed random {@code double} number between 0.0
     * inclusively and 1.0 exclusively.
     *
     * @return {number} a random {@code double} in the range [0.0 - 1.0)
     * @see #nextFloat
     */
    nextDouble() {
        return this.nextInternal(26) * Random.twoToTheMinus26 + this.nextInternal(27) * Random.twoToTheMinus53;
    }
    /**
     * Generates a normally distributed random {@code float} number between 0.0
     * inclusively and 1.0 exclusively.
     *
     * @return {number} float a random {@code float} number between [0.0 and 1.0)
     * @see #nextDouble
     */
    nextFloat() {
        return Math.fround((this.nextInternal(24) * Random.twoToTheMinus24));
    }
    /**
     * Pseudo-randomly generates (approximately) a normally distributed {@code
     * double} value with mean 0.0 and a standard deviation value of {@code 1.0}
     * using the <i>polar method<i> of G. E. P. Box, M. E. Muller, and G.
     * Marsaglia, as described by Donald E. Knuth in <i>The Art of Computer
     * Programming, Volume 2: Seminumerical Algorithms</i>, section 3.4.1,
     * subsection C, algorithm P.
     *
     * @return {number} a random {@code double}
     * @see #nextDouble
     */
    nextGaussian() {
        if (this.haveNextNextGaussian) {
            this.haveNextNextGaussian = false;
            return this.nextNextGaussian;
        }
        let v1;
        let v2;
        let s;
        do {
            {
                v1 = 2 * this.nextDouble() - 1;
                v2 = 2 * this.nextDouble() - 1;
                s = v1 * v1 + v2 * v2;
            }
        } while ((s >= 1));
        const norm = (s === 0) ? 0.0 : Math.sqrt(-2.0 * Math.log(s) / s);
        this.nextNextGaussian = v2 * norm;
        this.haveNextNextGaussian = true;
        return v1 * norm;
    }
    /**
     * Generates a uniformly distributed 32-bit {@code int} value from the random
     * number sequence.
     *
     * @return {number} a uniformly distributed {@code int} value.
     * @see java.lang.Integer#MAX_VALUE
     * @see java.lang.Integer#MIN_VALUE
     * @see #next
     * @see #nextLong
     */
    nextInt() {
        return (this.nextInternal(32) | 0);
    }
    /**
     * Generates a uniformly distributed 64-bit integer value from the random
     * number sequence.
     *
     * @return {number} 64-bit random integer.
     * @see java.lang.Integer#MAX_VALUE
     * @see java.lang.Integer#MIN_VALUE
     * @see #next
     * @see #nextInt()
     * @see #nextInt(int)
     */
    nextLong() {
        return ((n => n < 0 ? Math.ceil(n) : Math.floor(n))(this.nextInternal(32)) << 32) + (n => n < 0 ? Math.ceil(n) : Math.floor(n))(this.nextInternal(32));
    }
    setSeed$long(seed) {
        this.setSeed$int$int((((seed >> 24) & 16777215) | 0), ((seed & 16777215) | 0));
    }
    /**
     * Returns a pseudo-random uniformly distributed {@code int} value of the
     * number of bits specified by the argument {@code bits} as described by
     * Donald E. Knuth in <i>The Art of Computer Programming, Volume 2:
     * Seminumerical Algorithms</i>, section 3.2.1.
     *
     * @param {number} bits number of bits of the returned value.
     * @return {number} a pseudo-random generated int number.
     * @see #nextBytes
     * @see #nextDouble
     * @see #nextFloat
     * @see #nextInt()
     * @see #nextInt(int)
     * @see #nextGaussian
     * @see #nextLong
     */
    next(bits) {
        return (this.nextInternal(bits) | 0);
    }
    /*private*/ nextInternal(bits) {
        let hi = this.seedhi * Random.multiplierLo + this.seedlo * Random.multiplierHi;
        let lo = this.seedlo * Random.multiplierLo + 11;
        const carry = Math.floor(lo * Random.twoToTheMinus24);
        hi += carry;
        lo -= carry * Random.twoToThe24;
        hi %= Random.twoToThe24;
        this.seedhi = hi;
        this.seedlo = lo;
        if (bits <= 24) {
            return Math.floor(this.seedhi * Random.twoToTheXMinus24_$LI$()[bits]);
        }
        else {
            const h = this.seedhi * (1 << (bits - 24));
            const l = Math.floor(this.seedlo * Random.twoToTheXMinus48_$LI$()[bits]);
            let dval = h + l;
            if (dval >= Random.twoToThe31) {
                dval -= Random.twoToThe32;
            }
            return dval;
        }
    }
    setSeed$int$int(seedhi, seedlo) {
        this.seedhi = seedhi ^ 1502;
        this.seedlo = seedlo ^ 15525485;
        this.haveNextNextGaussian = false;
    }
    setSeed(seedhi, seedlo) {
        if (((typeof seedhi === 'number') || seedhi === null) && ((typeof seedlo === 'number') || seedlo === null)) {
            return this.setSeed$int$int(seedhi, seedlo);
        }
        else if (((typeof seedhi === 'number') || seedhi === null) && seedlo === undefined) {
            return this.setSeed$long(seedhi);
        }
        else
            throw new Error('invalid overload');
    }
}
Random.__static_initialized = false;
Random.multiplierHi = 1502;
Random.multiplierLo = 15525485;
Random.twoToThe24 = 1.6777216E7;
Random.twoToThe31 = 2.147483648E9;
Random.twoToThe32 = 4.294967296E9;
Random.twoToTheMinus24 = 5.9604644775390625E-8;
Random.twoToTheMinus26 = 1.4901161193847656E-8;
Random.twoToTheMinus31 = 4.6566128730773926E-10;
Random.twoToTheMinus53 = 1.1102230246251565E-16;
/**
 * A value used to avoid two random number generators produced at the same
 * time having the same seed.
 */
Random.uniqueSeed = 0;
Random["__class"] = "Random";
class RandomUtils {
    static nextInt(random, bound) {
        if (bound <= 0) {
            throw Object.defineProperty(new Error(), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.IllegalArgumentException', 'java.lang.Exception'] });
        }
        else if (IntUtils.isPowerOfTwo(bound)) {
            return random.nextInt() & (bound - 1);
        }
        else {
            const local45 = (-2147483648 - ((4294967296 % (n => n < 0 ? Math.ceil(n) : Math.floor(n))(bound)) | 0)) | 0;
            let local48;
            do {
                {
                    local48 = random.nextInt();
                }
            } while ((local48 >= local45));
            return RandomUtils.method3538(local48, bound);
        }
    }
    /*private*/ static method3538(arg0, bound) {
        const local7 = arg0 >> 31 & bound - 1;
        return local7 + (arg0 + (arg0 >>> 31)) % bound;
    }
}
RandomUtils["__class"] = "RandomUtils";
class SecondaryLinkedList {
    constructor() {
        if (this.cursor === undefined) {
            this.cursor = null;
        }
        this.sentinel = new SecondaryNode();
        this.sentinel.secondaryPrev = this.sentinel;
        this.sentinel.secondaryNext = this.sentinel;
    }
    static insertAfter(node, position) {
        if (node.secondaryPrev != null) {
            node.unlinkSecondary();
        }
        node.secondaryNext = position.secondaryNext;
        node.secondaryPrev = position;
        node.secondaryPrev.secondaryNext = node;
        node.secondaryNext.secondaryPrev = node;
    }
    head() {
        const node = this.sentinel.secondaryNext;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        else {
            this.cursor = node.secondaryNext;
            return node;
        }
    }
    addTail(node) {
        if (node.secondaryPrev != null) {
            node.unlinkSecondary();
        }
        node.secondaryNext = this.sentinel;
        node.secondaryPrev = this.sentinel.secondaryPrev;
        node.secondaryPrev.secondaryNext = node;
        node.secondaryNext.secondaryPrev = node;
    }
    size() {
        let size = 0;
        let node = this.sentinel.secondaryNext;
        while ((this.sentinel !== node)) {
            {
                node = node.secondaryNext;
                size++;
            }
        }
        ;
        return size;
    }
    removeHead() {
        const node = this.sentinel.secondaryNext;
        if (this.sentinel === node) {
            return null;
        }
        else {
            node.unlinkSecondary();
            return node;
        }
    }
    clear() {
        while ((true)) {
            {
                const node = this.sentinel.secondaryNext;
                if (node === this.sentinel) {
                    this.cursor = null;
                    return;
                }
                node.unlinkSecondary();
            }
        }
        ;
    }
    next() {
        const node = this.cursor;
        if (this.sentinel === node) {
            this.cursor = null;
            return null;
        }
        else {
            this.cursor = node.secondaryNext;
            return node;
        }
    }
}
SecondaryLinkedList["__class"] = "SecondaryLinkedList";
class TextureMathUtils {
    static __static_initialize() { if (!TextureMathUtils.__static_initialized) {
        TextureMathUtils.__static_initialized = true;
        TextureMathUtils.__static_initializer_0();
    } }
    static INVERSE_SQUARE_ROOT_$LI$() { TextureMathUtils.__static_initialize(); if (TextureMathUtils.INVERSE_SQUARE_ROOT == null) {
        TextureMathUtils.INVERSE_SQUARE_ROOT = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(32896);
    } return TextureMathUtils.INVERSE_SQUARE_ROOT; }
    static __static_initializer_0() {
        let i = 0;
        for (let x = 0; x < 256; x++) {
            {
                for (let y = 0; y <= x; y++) {
                    {
                        TextureMathUtils.INVERSE_SQUARE_ROOT_$LI$()[i++] = ((255.0 / Math.sqrt(Math.fround((x * x + y * y + 65535) / 65535.0))) | 0);
                    }
                    ;
                }
            }
            ;
        }
    }
}
TextureMathUtils.__static_initialized = false;
TextureMathUtils["__class"] = "TextureMathUtils";
class TextureOpRasterizerShape {
    constructor(fillColor, outlineColor, outlineWidth) {
        if (this.fillColor === undefined) {
            this.fillColor = 0;
        }
        if (this.outlineWidth === undefined) {
            this.outlineWidth = 0;
        }
        if (this.outlineColor === undefined) {
            this.outlineColor = 0;
        }
        this.fillColor = fillColor;
        this.outlineWidth = outlineWidth;
        this.outlineColor = outlineColor;
    }
}
TextureOpRasterizerShape["__class"] = "TextureOpRasterizerShape";
class Buffer extends Node {
    constructor(bytes) {
        if (((bytes != null && bytes instanceof Array && (bytes.length == 0 || bytes[0] == null || (typeof bytes[0] === 'number'))) || bytes === null)) {
            let __args = arguments;
            super();
            if (this.bytes === undefined) {
                this.bytes = null;
            }
            if (this.position === undefined) {
                this.position = 0;
            }
            this.bytes = bytes;
            this.position = 0;
        }
        else if (((typeof bytes === 'number') || bytes === null)) {
            let __args = arguments;
            let size = __args[0];
            super();
            if (this.bytes === undefined) {
                this.bytes = null;
            }
            if (this.position === undefined) {
                this.position = 0;
            }
            this.bytes = BufferPool.allocate(size);
            this.position = 0;
        }
        else
            throw new Error('invalid overload');
    }
    static crc32$byte_A$int$int(bytes, off, len) {
        throw Object.defineProperty(new Error("removed"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    static crc32(bytes, off, len) {
        if (((bytes != null && bytes instanceof Array && (bytes.length == 0 || bytes[0] == null || (typeof bytes[0] === 'number'))) || bytes === null) && ((typeof off === 'number') || off === null) && ((typeof len === 'number') || len === null)) {
            return Buffer.crc32$byte_A$int$int(bytes, off, len);
        }
        else if (((bytes != null && bytes instanceof Array && (bytes.length == 0 || bytes[0] == null || (typeof bytes[0] === 'number'))) || bytes === null) && ((typeof off === 'number') || off === null) && len === undefined) {
            return Buffer.crc32$byte_A$int(bytes, off);
        }
        else
            throw new Error('invalid overload');
    }
    static crc32$byte_A$int(bytes, len) {
        return Buffer.crc32$byte_A$int$int(bytes, 0, len);
    }
    static getStringLength(value) {
        return value.length + 1;
    }
    writeString(value) {
        throw Object.defineProperty(new Error("removed"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    readShort() {
        this.position += 2;
        let value = ((this.bytes[this.position - 2] & 255) << 8) + (this.bytes[this.position - 1] & 255);
        if (value > 32767) {
            value -= 65536;
        }
        return value;
    }
    writeUnsignedShortSmart(value) {
        if (value >= 0 && value < 128) {
            this.writeByte(value);
        }
        else if (value >= 0 && value < 32768) {
            this.writeShort(value + 32768);
        }
        else {
            throw Object.defineProperty(new Error(), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.IllegalArgumentException', 'java.lang.Exception'] });
        }
    }
    writeByteC(value) {
        this.bytes[this.position++] = (-value | 0);
    }
    readUnsignedShortSmart() {
        const peek = this.bytes[this.position] & 255;
        return peek < 128 ? this.readUnsignedByte() : this.readUnsignedShort() - 32768;
    }
    writeVarInt(value) {
        if ((value & -128) !== 0) {
            if ((value & -16384) !== 0) {
                if ((value & -2097152) !== 0) {
                    if ((value & -268435456) !== 0) {
                        this.writeByte(value >>> 28 | 128);
                    }
                    this.writeByte(value >>> 21 | 128);
                }
                this.writeByte(value >>> 14 | 128);
            }
            this.writeByte(value >>> 7 | 128);
        }
        this.writeByte(value & 127);
    }
    writeByte(value) {
        this.bytes[this.position++] = (value | 0);
    }
    writeLong(value) {
        this.bytes[this.position++] = ((value >> 56) | 0);
        this.bytes[this.position++] = ((value >> 48) | 0);
        this.bytes[this.position++] = ((value >> 40) | 0);
        this.bytes[this.position++] = ((value >> 32) | 0);
        this.bytes[this.position++] = ((value >> 24) | 0);
        this.bytes[this.position++] = ((value >> 16) | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = (value | 0);
    }
    readIntAlt3Reverse() {
        this.position += 4;
        return ((this.bytes[this.position - 1] & 255) << 16) + ((this.bytes[this.position - 2] & 255) << 24) + ((this.bytes[this.position - 4] & 255) << 8) + (this.bytes[this.position - 3] & 255);
    }
    writeIntAlt3(value) {
        this.bytes[this.position++] = ((value >> 16) | 0);
        this.bytes[this.position++] = ((value >> 24) | 0);
        this.bytes[this.position++] = (value | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
    }
    readShortLE() {
        this.position += 2;
        let value = ((this.bytes[this.position - 1] & 255) << 8) + (this.bytes[this.position - 2] & 255);
        if (value > 32767) {
            value -= 65536;
        }
        return value;
    }
    writeByteS(value) {
        this.bytes[this.position++] = ((128 - value) | 0);
    }
    readIntAlt3() {
        this.position += 4;
        return (this.bytes[this.position - 2] & 255) + ((this.bytes[this.position - 4] & 255) << 16) + ((this.bytes[this.position - 3] & 255) << 24) + ((this.bytes[this.position - 1] & 255) << 8);
    }
    readUnsignedShortLEA() {
        this.position += 2;
        return ((this.bytes[this.position - 1] & 255) << 8) + (this.bytes[this.position - 2] - 128 & 255);
    }
    readUnsignedByteC() {
        return -this.bytes[this.position++] & 255;
    }
    method4590() {
        this.position += 3;
        return ((this.bytes[this.position - 2] & 255) << 16) + ((this.bytes[this.position - 3] & 255) << 8) + (this.bytes[this.position - 1] & 255);
    }
    writeIntAlt3Reverse(value) {
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = (value | 0);
        this.bytes[this.position++] = ((value >> 24) | 0);
        this.bytes[this.position++] = ((value >> 16) | 0);
    }
    readString() {
        throw Object.defineProperty(new Error("removed"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    writeBytes(bytes, len) {
        for (let i = 0; i < len; i++) {
            {
                this.bytes[this.position++] = bytes[i];
            }
            ;
        }
    }
    readInt() {
        this.position += 4;
        return (this.bytes[this.position - 1] & 255) + ((this.bytes[this.position - 4] & 255) << 24) + ((this.bytes[this.position - 3] & 255) << 16) + ((this.bytes[this.position - 2] & 255) << 8);
    }
    readVarLong(bytes) {
        bytes--;
        if (bytes < 0 || bytes > 7) {
            throw Object.defineProperty(new Error(), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.IllegalArgumentException', 'java.lang.Exception'] });
        }
        let value = 0;
        for (let shift = bytes * 8; shift >= 0; shift -= 8) {
            {
                value |= ((n => n < 0 ? Math.ceil(n) : Math.floor(n))(this.bytes[this.position++]) & 255) << shift;
            }
            ;
        }
        return value;
    }
    readShortSmart() {
        const peek = this.bytes[this.position] & 255;
        return peek < 128 ? this.readUnsignedByte() - 64 : this.readUnsignedShort() - 49152;
    }
    readUnsignedMultiSmart() {
        let total = 0;
        let value;
        for (value = this.readUnsignedShortSmart(); value === 32767; value = this.readUnsignedShortSmart()) {
            {
                total += 32767;
            }
            ;
        }
        return total + value;
    }
    writeIntLE(value) {
        this.bytes[this.position++] = (value | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = ((value >> 16) | 0);
        this.bytes[this.position++] = ((value >> 24) | 0);
    }
    readBytesA(bytes, len) {
        for (let i = 0; i < len; i++) {
            {
                bytes[i] = ((this.bytes[this.position++] - 128) | 0);
            }
            ;
        }
    }
    verifyCrc32() {
        this.position -= 4;
        const actual = Buffer.crc32$byte_A$int$int(this.bytes, 0, this.position);
        const expected = this.readInt();
        return actual === expected;
    }
    writeMedium(value) {
        this.bytes[this.position++] = ((value >> 16) | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = (value | 0);
    }
    writeShortLE(value) {
        this.bytes[this.position++] = (value | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
    }
    writeFloat(value) {
        const bits = ((f) => { let buf = new ArrayBuffer(4); (new Float32Array(buf))[0] = f; return (new Uint32Array(buf))[0]; })(value);
        this.bytes[this.position++] = ((bits >> 24) | 0);
        this.bytes[this.position++] = ((bits >> 16) | 0);
        this.bytes[this.position++] = ((bits >> 8) | 0);
        this.bytes[this.position++] = (bits | 0);
    }
    readUnsignedByteS() {
        return 128 - this.bytes[this.position++] & 255;
    }
    writeVarLong(value, bytes) {
        bytes--;
        if (bytes < 0 || bytes > 7) {
            throw Object.defineProperty(new Error(), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.IllegalArgumentException', 'java.lang.Exception'] });
        }
        for (let shift = bytes * 8; shift >= 0; shift -= 8) {
            {
                this.bytes[this.position++] = ((value >> shift) | 0);
            }
            ;
        }
    }
    xteaDecrypt(key, len) {
        const blocks = ((len - 5) / 8 | 0);
        const position = this.position;
        this.position = 5;
        for (let i = 0; i < blocks; i++) {
            {
                let v0 = this.readInt();
                let v1 = this.readInt();
                let sum = -957401312;
                let rounds = 32;
                while ((rounds-- > 0)) {
                    {
                        v1 -= (v0 << 4 ^ v0 >>> 5) + v0 ^ key[sum >>> 11 & 3] + sum;
                        sum -= -1640531527;
                        v0 -= (v1 << 4 ^ v1 >>> 5) + v1 ^ sum + key[sum & 3];
                    }
                }
                ;
                this.position -= 8;
                this.writeInt(v0);
                this.writeInt(v1);
            }
            ;
        }
        this.position = position;
    }
    readByteS() {
        return ((128 - this.bytes[this.position++]) | 0);
    }
    readVarInt() {
        let b = this.bytes[this.position++];
        let value = 0;
        while ((b < 0)) {
            {
                value = (b & 127 | value) << 7;
                b = this.bytes[this.position++];
            }
        }
        ;
        return value | b;
    }
    writeIntLength(len) {
        this.bytes[this.position - len - 4] = ((len >> 24) | 0);
        this.bytes[this.position - len - 3] = ((len >> 16) | 0);
        this.bytes[this.position - len - 2] = ((len >> 8) | 0);
        this.bytes[this.position - len - 1] = (len | 0);
    }
    writeByteA(value) {
        this.bytes[this.position++] = ((value + 128) | 0);
    }
    readBytes(bytes, len) {
        for (let i = 0; i < len; i++) {
            {
                bytes[i] = this.bytes[this.position++];
            }
            ;
        }
    }
    writeShortLE2(value) {
        this.bytes[this.position++] = (value | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
    }
    writeShortA(arg0) {
        this.bytes[this.position++] = ((arg0 >> 8) | 0);
        this.bytes[this.position++] = ((arg0 + 128) | 0);
    }
    readByteC() {
        return (-this.bytes[this.position++] | 0);
    }
    readUnsignedShort() {
        this.position += 2;
        return (this.bytes[this.position - 1] & 255) + ((this.bytes[this.position - 2] & 255) << 8);
    }
    writeInt(value) {
        this.bytes[this.position++] = ((value >> 24) | 0);
        this.bytes[this.position++] = ((value >> 16) | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = (value | 0);
    }
    readUnsignedMedium() {
        this.position += 3;
        return (this.bytes[this.position - 1] & 255) + ((this.bytes[this.position - 3] & 255) << 16) + ((this.bytes[this.position - 2] & 255) << 8);
    }
    readIntLE() {
        this.position += 4;
        return (this.bytes[this.position - 4] & 255) + ((this.bytes[this.position - 1] & 255) << 24) + ((this.bytes[this.position - 2] & 255) << 16) + ((this.bytes[this.position - 3] & 255) << 8);
    }
    writeCrc32(off) {
        const checksum = Buffer.crc32$byte_A$int$int(this.bytes, off, this.position);
        this.writeInt(checksum);
        return checksum;
    }
    readLong() {
        const high = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(this.readInt()) & 4294967295;
        const low = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(this.readInt()) & 4294967295;
        return (high << 32) + low;
    }
    readUnsignedByteA() {
        return this.bytes[this.position++] - 128 & 255;
    }
    writeIntLE2(value) {
        this.bytes[this.position++] = (value | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = ((value >> 16) | 0);
        this.bytes[this.position++] = ((value >> 24) | 0);
    }
    readStringFast() {
        if (this.bytes[this.position] === 0) {
            this.position++;
            return null;
        }
        else {
            return this.readString();
        }
    }
    readShortA() {
        this.position += 2;
        let value = (this.bytes[this.position - 1] - 128 & 255) + ((this.bytes[this.position - 2] & 255) << 8);
        if (value > 32767) {
            value -= 65536;
        }
        return value;
    }
    xteaEncrypt(key) {
        const position = (this.position / 8 | 0);
        this.position = 0;
        for (let i = 0; i < position; i++) {
            {
                let v0 = this.readInt();
                let v1 = this.readInt();
                let sum = 0;
                let rounds = 32;
                while ((rounds-- > 0)) {
                    {
                        v0 += v1 + (v1 << 4 ^ v1 >>> 5) ^ sum + key[sum & 3];
                        sum += -1640531527;
                        v1 += sum + key[sum >>> 11 & -1354760189] ^ (v0 >>> 5 ^ v0 << 4) + v0;
                    }
                }
                ;
                this.position -= 8;
                this.writeInt(v0);
                this.writeInt(v1);
            }
            ;
        }
    }
    readUnsignedByte() {
        return this.bytes[this.position++] & 255;
    }
    readUnsignedShortA() {
        this.position += 2;
        return ((this.bytes[this.position - 2] & 255) << 8) + (this.bytes[this.position - 1] - 128 & 255);
    }
    writeShort(value) {
        this.bytes[this.position++] = ((value >> 8) | 0);
        this.bytes[this.position++] = (value | 0);
    }
    writeFloatLE(value) {
        const bits = ((f) => { let buf = new ArrayBuffer(4); (new Float32Array(buf))[0] = f; return (new Uint32Array(buf))[0]; })(value);
        this.bytes[this.position++] = (bits | 0);
        this.bytes[this.position++] = ((bits >> 8) | 0);
        this.bytes[this.position++] = ((bits >> 16) | 0);
        this.bytes[this.position++] = ((bits >> 24) | 0);
    }
    readVersionedString() {
        throw Object.defineProperty(new Error("removed"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    readBytesReverse(bytes, len) {
        for (let i = len - 1; i >= 0; i--) {
            {
                bytes[i] = this.bytes[this.position++];
            }
            ;
        }
    }
    readUnsignedShortLE() {
        this.position += 2;
        return ((this.bytes[this.position - 1] & 255) << 8) + (this.bytes[this.position - 2] & 255);
    }
    writeShortLEA(value) {
        this.bytes[this.position++] = ((value + 128) | 0);
        this.bytes[this.position++] = ((value >> 8) | 0);
    }
    readByte() {
        return this.bytes[this.position++];
    }
    writeByteLength(len) {
        this.bytes[this.position - len - 1] = (len | 0);
    }
}
Buffer["__class"] = "Buffer";
class ColorImageCacheEntry extends Node {
    constructor(row, index) {
        super();
        if (this.row === undefined) {
            this.row = 0;
        }
        if (this.index === undefined) {
            this.index = 0;
        }
        this.row = row;
        this.index = index;
    }
    static VALID_$LI$() { if (ColorImageCacheEntry.VALID == null) {
        ColorImageCacheEntry.VALID = new ColorImageCacheEntry(0, 0);
    } return ColorImageCacheEntry.VALID; }
}
ColorImageCacheEntry["__class"] = "ColorImageCacheEntry";
class MonochromeImageCacheEntry extends Node {
    constructor(row, index) {
        super();
        if (this.row === undefined) {
            this.row = 0;
        }
        if (this.index === undefined) {
            this.index = 0;
        }
        this.row = row;
        this.index = index;
    }
    static VALID_$LI$() { if (MonochromeImageCacheEntry.VALID == null) {
        MonochromeImageCacheEntry.VALID = new MonochromeImageCacheEntry(0, 0);
    } return MonochromeImageCacheEntry.VALID; }
}
MonochromeImageCacheEntry["__class"] = "MonochromeImageCacheEntry";
class SecondaryNode extends Node {
    constructor() {
        super();
        if (this.secondaryPrev === undefined) {
            this.secondaryPrev = null;
        }
        if (this.secondaryKey === undefined) {
            this.secondaryKey = 0;
        }
        if (this.secondaryNext === undefined) {
            this.secondaryNext = null;
        }
    }
    unlinkSecondary() {
        if (this.secondaryPrev != null) {
            this.secondaryPrev.secondaryNext = this.secondaryNext;
            this.secondaryNext.secondaryPrev = this.secondaryPrev;
            this.secondaryPrev = null;
            this.secondaryNext = null;
        }
    }
    isSecondaryLinked() {
        return this.secondaryPrev != null;
    }
}
SecondaryNode["__class"] = "SecondaryNode";
class TextureOp extends Node {
    constructor(childOpsCount, monochrome) {
        super();
        if (this.colorImageCache === undefined) {
            this.colorImageCache = null;
        }
        if (this.monochromeImageCache === undefined) {
            this.monochromeImageCache = null;
        }
        if (this.imageCacheCapacity === undefined) {
            this.imageCacheCapacity = 0;
        }
        if (this.monochrome === undefined) {
            this.monochrome = false;
        }
        if (this.childOps === undefined) {
            this.childOps = null;
        }
        this.monochrome = monochrome;
        this.childOps = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(childOpsCount);
    }
    static permutations_$LI$() { if (TextureOp.permutations == null) {
        TextureOp.permutations = new LruHashTable(16);
    } return TextureOp.permutations; }
    static createTrigonometryTables() {
        if (TextureOp.SINE != null && TextureOp.COSINE != null) {
            return;
        }
        TextureOp.COSINE = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(256);
        TextureOp.SINE = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(256);
        for (let i = 0; i < 256; i++) {
            {
                const radians = i / 255.0 * 6.283185307179586;
                TextureOp.SINE[i] = ((Math.sin(radians) * 4096.0) | 0);
                TextureOp.COSINE[i] = ((Math.cos(radians) * 4096.0) | 0);
            }
            ;
        }
    }
    static getPermutation(seed) {
        let node = TextureOp.permutations_$LI$().get(seed);
        if (node == null) {
            const permutation = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(512);
            const random = new Random(seed);
            for (let i = 0; i < 255; i++) {
                {
                    permutation[i] = (i | 0);
                }
                ;
            }
            for (let i = 0; i < 255; i++) {
                {
                    const j = 255 - i;
                    const k = RandomUtils.nextInt(random, j);
                    const temp = permutation[k];
                    permutation[k] = permutation[j];
                    permutation[j] = permutation[511 - i] = temp;
                }
                ;
            }
            node = new ByteArraySecondaryNode(permutation);
            TextureOp.permutations_$LI$().put(seed, node);
        }
        return node.value;
    }
    static perlinFade(t) {
        const cube = ((t * t >> 12) * t >> 12) | 0;
        const mul6Sub15 = (t * 6 - 61440) | 0;
        const mulTAdd10 = ((t * mul6Sub15 >> 12) + 40960) | 0;
        return (cube * mulTAdd10 >> 12) | 0;
    }
    static decode(buffer) {
        buffer.readUnsignedByte();
        const type = buffer.readUnsignedByte();
        const op = TextureOp.create(type);
        op.imageCacheCapacity = buffer.readUnsignedByte();
        const codes = buffer.readUnsignedByte();
        for (let i = 0; i < codes; i++) {
            {
                const code = buffer.readUnsignedByte();
                op.decode(buffer, code);
            }
            ;
        }
        op.postDecode();
        return op;
    }
    /*private*/ static create(type) {
        if (type === 0) {
            return new TextureOpMonochromeFill();
        }
        else if (type === 1) {
            return new TextureOpColorFill();
        }
        else if (type === 2) {
            return new TextureOpHorizontalGradient();
        }
        else if (type === 3) {
            return new TextureOpVerticalGradient();
        }
        else if (type === 4) {
            return new TextureOpBricks();
        }
        else if (type === 5) {
            return new TextureOpBoxBlur();
        }
        else if (type === 6) {
            return new TextureOpClamp();
        }
        else if (type === 7) {
            return new TextureOpCombine();
        }
        else if (type === 8) {
            return new TextureOpCurve();
        }
        else if (type === 9) {
            return new TextureOpFlip();
        }
        else if (type === 10) {
            return new TextureOpColorGradient();
        }
        else if (type === 11) {
            return new TextureOpColorize();
        }
        else if (type === 12) {
            return new TextureOpWaveform();
        }
        else if (type === 13) {
            return new TextureOpNoise();
        }
        else if (type === 14) {
            return new TextureOpWeave();
        }
        else if (type === 15) {
            return new TextureOpVoronoiNoise();
        }
        else if (type === 16) {
            return new TextureOpHerringbone();
        }
        else if (type === 17) {
            return new TextureOpHslAdjust();
        }
        else if (type === 18) {
            return new TextureOpTiledSprite();
        }
        else if (type === 19) {
            return new TextureOpPolarDistortion();
        }
        else if (type === 20) {
            return new TextureOpTile();
        }
        else if (type === 21) {
            return new TextureOpInterpolate();
        }
        else if (type === 22) {
            return new TextureOpInvert();
        }
        else if (type === 23) {
            return new TextureOpKaleidoscope();
        }
        else if (type === 24) {
            return new TextureOpMonochrome();
        }
        else if (type === 25) {
            return new TextureOpBrightness();
        }
        else if (type === 26) {
            return new TextureOpBinary();
        }
        else if (type === 27) {
            return new TextureOpSquareWaveform();
        }
        else if (type === 28) {
            return new TextureOpIrregularBricks();
        }
        else if (type === 29) {
            return new TextureOpRasterizer();
        }
        else if (type === 30) {
            return new TextureOpRange();
        }
        else if (type === 31) {
            return new TextureOpMandelbrot();
        }
        else if (type === 32) {
            return new TextureOpEmboss();
        }
        else if (type === 33) {
            return new TextureOpColorEdgeDetector();
        }
        else if (type === 34) {
            return new TextureOpPerlinNoise();
        }
        else if (type === 35) {
            return new TextureOpMonochromeEdgeDetector();
        }
        else if (type === 36) {
            return new TextureOpTexture();
        }
        else if (type === 37) {
            return new TextureOp37();
        }
        else if (type === 38) {
            return new TextureOpLineNoise();
        }
        else if (type === 39) {
            return new TextureOpSprite();
        }
        else {
            return null;
        }
    }
    getChildColorOutput(index, y) {
        if (!this.childOps[index].monochrome) {
            return this.childOps[index].getColorOutput(y);
        }
        const colorRow = [null, null, null];
        const monochromeRow = this.childOps[index].getMonochromeOutput(y);
        colorRow[0] = monochromeRow;
        colorRow[2] = monochromeRow;
        colorRow[1] = monochromeRow;
        return colorRow;
    }
    decode(buffer, code) {
    }
    getSpriteId() {
        return -1;
    }
    getTextureId() {
        return -1;
    }
    getMonochromeOutput(y) {
        throw Object.defineProperty(new Error("This operation does not have a monochrome output"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.IllegalStateException', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    getColorOutput(y) {
        throw Object.defineProperty(new Error("This operation does not have a colour output"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.IllegalStateException', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
    }
    clearImageCache() {
        if (this.monochrome) {
            this.monochromeImageCache.clear();
            this.monochromeImageCache = null;
        }
        else {
            this.colorImageCache.clear();
            this.colorImageCache = null;
        }
    }
    createImageCache(height, width) {
        const capacity = this.imageCacheCapacity === 255 ? height : this.imageCacheCapacity;
        if (this.monochrome) {
            this.monochromeImageCache = new MonochromeImageCache(capacity, height, width);
        }
        else {
            this.colorImageCache = new ColorImageCache(capacity, height, width);
        }
    }
    getChildMonochromeOutput(index, y) {
        return this.childOps[index].monochrome ? this.childOps[index].getMonochromeOutput(y) : this.childOps[index].getColorOutput(y)[0];
    }
    postDecode() {
    }
}
TextureOp.COSINE = null;
TextureOp.SINE = null;
TextureOp["__class"] = "TextureOp";
class TextureOpRasterizerBezierCurve extends TextureOpRasterizerShape {
    constructor(x0, y0, x1, y1, x2, y2, x3, y3, color, outlineWidth) {
        super(-1, color, outlineWidth);
        if (this.y1 === undefined) {
            this.y1 = 0;
        }
        if (this.x0 === undefined) {
            this.x0 = 0;
        }
        if (this.y0 === undefined) {
            this.y0 = 0;
        }
        if (this.x1 === undefined) {
            this.x1 = 0;
        }
        if (this.x2 === undefined) {
            this.x2 = 0;
        }
        if (this.y2 === undefined) {
            this.y2 = 0;
        }
        if (this.x3 === undefined) {
            this.x3 = 0;
        }
        if (this.y3 === undefined) {
            this.y3 = 0;
        }
        this.y1 = y1;
        this.x0 = x0;
        this.y0 = y0;
        this.x1 = x1;
        this.x2 = x2;
        this.y2 = y2;
        this.x3 = x3;
        this.y3 = y3;
    }
    static create(buffer) {
        return new TextureOpRasterizerBezierCurve(buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readUnsignedMedium(), buffer.readUnsignedByte());
    }
    renderOutline(width, height) {
        const x0 = width * this.x0 >> 12;
        const x1 = width * this.x1 >> 12;
        const y1 = height * this.y1 >> 12;
        const x2 = width * this.x2 >> 12;
        const y0 = height * this.y0 >> 12;
        const y2 = height * this.y2 >> 12;
        const y3 = height * this.y3 >> 12;
        const x3 = width * this.x3 >> 12;
        MergedStatics.sub22_method4693(x1, y1, this.outlineColor, x2, x3, y0, y3, y2, x0);
    }
    renderFill(width, height) {
    }
    render(width, height) {
    }
}
TextureOpRasterizerBezierCurve["__class"] = "TextureOpRasterizerBezierCurve";
class TextureOpRasterizerEllipse extends TextureOpRasterizerShape {
    constructor(x, y, horizontalRadius, verticalRadius, fillColor, outlineColor, outlineWidth) {
        super(fillColor, outlineColor, outlineWidth);
        if (this.x === undefined) {
            this.x = 0;
        }
        if (this.horizontalRadius === undefined) {
            this.horizontalRadius = 0;
        }
        if (this.y === undefined) {
            this.y = 0;
        }
        if (this.verticalRadius === undefined) {
            this.verticalRadius = 0;
        }
        this.x = x;
        this.horizontalRadius = horizontalRadius;
        this.y = y;
        this.verticalRadius = verticalRadius;
    }
    static create(buffer) {
        return new TextureOpRasterizerEllipse(buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readUnsignedMedium(), buffer.readUnsignedMedium(), buffer.readUnsignedByte());
    }
    render(width, height) {
        const x = this.x * width >> 12;
        const horizontalRadius = this.horizontalRadius * width >> 12;
        const verticalRadius = this.verticalRadius * height >> 12;
        const y = this.y * height >> 12;
        MergedStatics.sub18_method1745(horizontalRadius, this.fillColor, x, this.outlineColor, this.outlineWidth, y, verticalRadius);
    }
    renderFill(width, height) {
        const x = this.x * width >> 12;
        const horizontalRadius = this.horizontalRadius * width >> 12;
        const verticalRadius = this.verticalRadius * height >> 12;
        const y = this.y * height >> 12;
        MergedStatics.sub28_method3323(verticalRadius, x, this.fillColor, y, horizontalRadius);
    }
    renderOutline(width, height) {
    }
}
TextureOpRasterizerEllipse["__class"] = "TextureOpRasterizerEllipse";
class TextureOpRasterizerLine extends TextureOpRasterizerShape {
    constructor(x0, y0, x1, y1, color, outlineWidth) {
        super(-1, color, outlineWidth);
        if (this.x1 === undefined) {
            this.x1 = 0;
        }
        if (this.y0 === undefined) {
            this.y0 = 0;
        }
        if (this.x0 === undefined) {
            this.x0 = 0;
        }
        if (this.y1 === undefined) {
            this.y1 = 0;
        }
        this.x1 = x1;
        this.y0 = y0;
        this.x0 = x0;
        this.y1 = y1;
    }
    static create(buffer) {
        return new TextureOpRasterizerLine(buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readUnsignedMedium(), buffer.readUnsignedByte());
    }
    renderFill(width, height) {
    }
    renderOutline(width, height) {
        const x0 = this.x0 * width >> 12;
        const x1 = this.x1 * width >> 12;
        const y1 = this.y1 * height >> 12;
        const y0 = this.y0 * height >> 12;
        MergedStatics.sub32_method4022(y0, y1, this.outlineColor, x0, x1);
    }
    render(width, height) {
    }
}
TextureOpRasterizerLine["__class"] = "TextureOpRasterizerLine";
class TextureOpRasterizerRectangle extends TextureOpRasterizerShape {
    constructor(x0, y0, x1, y1, fillColor, outlineColor, outlineWidth) {
        super(fillColor, outlineColor, outlineWidth);
        if (this.x1 === undefined) {
            this.x1 = 0;
        }
        if (this.y1 === undefined) {
            this.y1 = 0;
        }
        if (this.x0 === undefined) {
            this.x0 = 0;
        }
        if (this.y0 === undefined) {
            this.y0 = 0;
        }
        this.x1 = x1;
        this.y1 = y1;
        this.x0 = x0;
        this.y0 = y0;
    }
    static create(buffer) {
        return new TextureOpRasterizerRectangle(buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readShort(), buffer.readUnsignedMedium(), buffer.readUnsignedMedium(), buffer.readUnsignedByte());
    }
    render(width, height) {
        const x0 = this.x0 * width >> 12;
        const y0 = this.y0 * height >> 12;
        const x1 = this.x1 * width >> 12;
        const y1 = this.y1 * height >> 12;
        MergedStatics.sub36_method4566(x0, this.outlineColor, this.fillColor, this.outlineWidth, y1, x1, y0);
    }
    renderOutline(width, height) {
        const x0 = this.x0 * width >> 12;
        const x1 = this.x1 * width >> 12;
        const y0 = this.y0 * height >> 12;
        const y1 = this.y1 * height >> 12;
        MergedStatics.sub32_method3997(x0, this.outlineColor, y0, this.outlineWidth, y1, x1);
    }
    renderFill(width, height) {
        const x0 = this.x0 * width >> 12;
        const x1 = this.x1 * width >> 12;
        const y0 = this.y0 * height >> 12;
        const y1 = this.y1 * height >> 12;
        MergedStatics.sub29_method3429(x0, y1, x1, y0, this.fillColor);
    }
}
TextureOpRasterizerRectangle["__class"] = "TextureOpRasterizerRectangle";
class ByteArraySecondaryNode extends SecondaryNode {
    constructor(value) {
        super();
        if (this.value === undefined) {
            this.value = null;
        }
        this.value = value;
    }
}
ByteArraySecondaryNode["__class"] = "ByteArraySecondaryNode";
class Sprite extends SecondaryNode {
    constructor() {
        super();
        if (this.innerWidth === undefined) {
            this.innerWidth = 0;
        }
        if (this.yOffset === undefined) {
            this.yOffset = 0;
        }
        if (this.xOffset === undefined) {
            this.xOffset = 0;
        }
        if (this.height === undefined) {
            this.height = 0;
        }
        if (this.width === undefined) {
            this.width = 0;
        }
        if (this.innerHeight === undefined) {
            this.innerHeight = 0;
        }
    }
    renderRotatedScaledTransparent$int$int$int$int$int$int(pivotX, pivotY, x, y, angle, scale) { throw new Error('cannot invoke abstract overloaded method... check your argument(s) type(s)'); }
    renderRotatedScaledTransparent(pivotX, pivotY, x, y, angle, scale) {
        if (((typeof pivotX === 'number') || pivotX === null) && ((typeof pivotY === 'number') || pivotY === null) && ((typeof x === 'number') || x === null) && ((typeof y === 'number') || y === null) && ((typeof angle === 'number') || angle === null) && ((typeof scale === 'number') || scale === null)) {
            return this.renderRotatedScaledTransparent$int$int$int$int$int$int(pivotX, pivotY, x, y, angle, scale);
        }
        else if (((typeof pivotX === 'number') || pivotX === null) && ((typeof pivotY === 'number') || pivotY === null) && ((typeof x === 'number') || x === null) && ((typeof y === 'number') || y === null) && angle === undefined && scale === undefined) {
            return this.renderRotatedScaledTransparent$int$int$int$int(pivotX, pivotY, x, y);
        }
        else
            throw new Error('invalid overload');
    }
    renderRotatedScaledTransparent$int$int$int$int(y, angle, x, scale) {
        const halfInnerWidth = this.innerWidth << 3;
        x = (halfInnerWidth & 15) + (x << 4);
        const halfInnerHeight = this.innerHeight << 3;
        y = (halfInnerHeight & 15) + (y << 4);
        this.renderRotatedScaledTransparent$int$int$int$int$int$int(halfInnerWidth, halfInnerHeight, x, y, angle, scale);
    }
}
Sprite["__class"] = "Sprite";
class Texture extends SecondaryNode {
    constructor(buffer) {
        super();
        if (this.spriteIds === undefined) {
            this.spriteIds = null;
        }
        if (this.textureIds === undefined) {
            this.textureIds = null;
        }
        if (this.brightnessOp === undefined) {
            this.brightnessOp = null;
        }
        if (this.colorOp === undefined) {
            this.colorOp = null;
        }
        if (this.alphaOp === undefined) {
            this.alphaOp = null;
        }
        if (this.ops === undefined) {
            this.ops = null;
        }
        let spriteCount = 0;
        const opCount = buffer.readUnsignedByte();
        this.ops = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(opCount);
        let textureCount = 0;
        const childOpIds = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(opCount);
        for (let i = 0; i < opCount; i++) {
            {
                const op = TextureOp.decode(buffer);
                if (op.getSpriteId() >= 0) {
                    spriteCount++;
                }
                if (op.getTextureId() >= 0) {
                    textureCount++;
                }
                const childOpsCount = op.childOps.length;
                childOpIds[i] = (s => { let a = []; while (s-- > 0)
                    a.push(0); return a; })(childOpsCount);
                for (let j = 0; j < childOpsCount; j++) {
                    {
                        childOpIds[i][j] = buffer.readUnsignedByte();
                    }
                    ;
                }
                this.ops[i] = op;
            }
            ;
        }
        this.textureIds = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(textureCount);
        let textureIdsIndex = 0;
        this.spriteIds = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(spriteCount);
        let spriteIdsIndex = 0;
        for (let i = 0; i < opCount; i++) {
            {
                const op = this.ops[i];
                const childOpsCount = op.childOps.length;
                for (let j = 0; j < childOpsCount; j++) {
                    {
                        op.childOps[j] = this.ops[childOpIds[i][j]];
                    }
                    ;
                }
                const spriteId = op.getSpriteId();
                const textureId = op.getTextureId();
                if (spriteId > 0) {
                    this.spriteIds[spriteIdsIndex++] = spriteId;
                }
                if (textureId > 0) {
                    this.textureIds[textureIdsIndex++] = textureId;
                }
                childOpIds[i] = null;
            }
            ;
        }
        this.colorOp = this.ops[buffer.readUnsignedByte()];
        this.alphaOp = this.ops[buffer.readUnsignedByte()];
        this.brightnessOp = this.ops[buffer.readUnsignedByte()];
    }
    static brightnessMap_$LI$() { if (Texture.brightnessMap == null) {
        Texture.brightnessMap = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(256);
    } return Texture.brightnessMap; }
    /*private*/ static setBrightness(brightness) {
        if (Texture.brightness === brightness) {
            return;
        }
        for (let i = 0; i < 256; i++) {
            {
                const j = ((Math.pow(i / 255.0, brightness) * 255.0) | 0);
                Texture.brightnessMap_$LI$()[i] = j > 255 ? 255 : j;
            }
            ;
        }
        Texture.brightness = brightness;
    }
    static setSize(width, height) {
        if (width !== Texture.width) {
            Texture.normalisedX = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(width);
            for (let x = 0; x < width; x++) {
                {
                    Texture.normalisedX[x] = ((x << 12) / width | 0);
                }
                ;
            }
            Texture.widthMask = width - 1;
            Texture.width = width;
            Texture.widthTimes32 = width * 32;
        }
        if (height === Texture.height) {
            return;
        }
        if (height === Texture.width) {
            Texture.normalisedY = Texture.normalisedX;
        }
        else {
            Texture.normalisedY = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(height);
            for (let y = 0; y < height; y++) {
                {
                    Texture.normalisedY[y] = ((y << 12) / height | 0);
                }
                ;
            }
        }
        Texture.heightMask = height - 1;
        Texture.height = height;
    }
    getPixels(width, height, loadedtexes, brightness, columnMajor, flipHorizontal) {
        Texture.setBrightness(brightness);
        Texture.setSize(width, height);
        const pixels = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(width * height);
        for (let i = 0; i < this.ops.length; i++) {
            {
                this.ops[i].createImageCache(height, width);
            }
            ;
        }
        Texture.loadedTextures = loadedtexes;
        let x1;
        let dx;
        let x0;
        if (flipHorizontal) {
            x0 = width - 1;
            x1 = -1;
            dx = -1;
        }
        else {
            dx = 1;
            x1 = width;
            x0 = 0;
        }
        let index = 0;
        for (let y = 0; y < height; y++) {
            {
                if (columnMajor) {
                    index = y;
                }
                let reds;
                let greens;
                let blues;
                if (this.colorOp.monochrome) {
                    const output = this.colorOp.getMonochromeOutput(y);
                    greens = output;
                    blues = output;
                    reds = output;
                }
                else {
                    const output = this.colorOp.getColorOutput(y);
                    reds = output[0];
                    blues = output[2];
                    greens = output[1];
                }
                for (let x = x0; x !== x1; x += dx) {
                    {
                        let red = reds[x] >> 4;
                        let green = greens[x] >> 4;
                        if (green > 255) {
                            green = 255;
                        }
                        let blue = blues[x] >> 4;
                        if (red > 255) {
                            red = 255;
                        }
                        if (blue > 255) {
                            blue = 255;
                        }
                        if (green < 0) {
                            green = 0;
                        }
                        if (red < 0) {
                            red = 0;
                        }
                        const green2 = Texture.brightnessMap_$LI$()[green];
                        const red2 = Texture.brightnessMap_$LI$()[red];
                        if (blue < 0) {
                            blue = 0;
                        }
                        const blue2 = Texture.brightnessMap_$LI$()[blue];
                        pixels[index++] = blue2 + (red2 << 16) + (green2 << 8);
                        if (columnMajor) {
                            index += width - 1;
                        }
                    }
                    ;
                }
            }
            ;
        }
        for (let i = 0; i < this.ops.length; i++) {
            {
                this.ops[i].clearImageCache();
            }
            ;
        }
        return pixels;
    }
}
Texture.loadedTextures = null;
Texture.spriteGroupId = -1;
Texture.brightness = -1.0;
Texture.width = 0;
Texture.height = 0;
Texture.widthMask = 0;
Texture.heightMask = 0;
Texture.normalisedX = null;
Texture.normalisedY = null;
Texture.widthTimes32 = 0;
Texture["__class"] = "Texture";
class MonochromeImageCache {
    constructor(capacity, height, width) {
        this.size = 0;
        this.singleRow = -1;
        this.recentlyUsed = new LinkedList();
        this.invalid = false;
        if (this.height === undefined) {
            this.height = 0;
        }
        if (this.entries === undefined) {
            this.entries = null;
        }
        if (this.capacity === undefined) {
            this.capacity = 0;
        }
        if (this.pixels === undefined) {
            this.pixels = null;
        }
        this.height = height;
        this.entries = (s => { let a = []; while (s-- > 0)
            a.push(null); return a; })(this.height);
        this.capacity = capacity;
        this.pixels = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([this.capacity, width]);
    }
    static __static_initialize() { if (!MonochromeImageCache.__static_initialized) {
        MonochromeImageCache.__static_initialized = true;
        MonochromeImageCache.__static_initializer_0();
    } }
    static PERLIN_FADE_$LI$() { MonochromeImageCache.__static_initialize(); if (MonochromeImageCache.PERLIN_FADE == null) {
        MonochromeImageCache.PERLIN_FADE = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(4096);
    } return MonochromeImageCache.PERLIN_FADE; }
    static __static_initializer_0() {
        for (let t = 0; t < 4096; t++) {
            {
                MonochromeImageCache.PERLIN_FADE_$LI$()[t] = TextureOp.perlinFade(t);
            }
            ;
        }
    }
    get$() {
        if (this.capacity !== this.height) {
            throw Object.defineProperty(new Error("Can only retrieve a full image cache"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
        }
        for (let row = 0; row < this.capacity; row++) {
            {
                this.entries[row] = MonochromeImageCacheEntry.VALID_$LI$();
            }
            ;
        }
        return this.pixels;
    }
    get$int(row) {
        if (this.capacity === this.height) {
            this.invalid = this.entries[row] == null;
            this.entries[row] = MonochromeImageCacheEntry.VALID_$LI$();
            return this.pixels[row];
        }
        else if (this.capacity === 1) {
            this.invalid = row !== this.singleRow;
            this.singleRow = row;
            return this.pixels[0];
        }
        else {
            let entry = this.entries[row];
            if (entry == null) {
                this.invalid = true;
                if (this.capacity > this.size) {
                    entry = new MonochromeImageCacheEntry(row, this.size);
                    this.size++;
                }
                else {
                    const lruEntry = this.recentlyUsed.tail();
                    entry = new MonochromeImageCacheEntry(row, lruEntry.index);
                    this.entries[lruEntry.row] = null;
                    lruEntry.unlink();
                }
                this.entries[row] = entry;
            }
            else {
                this.invalid = false;
            }
            this.recentlyUsed.addHead(entry);
            return this.pixels[entry.index];
        }
    }
    get(row) {
        if (((typeof row === 'number') || row === null)) {
            return this.get$int(row);
        }
        else if (row === undefined) {
            return this.get$();
        }
        else
            throw new Error('invalid overload');
    }
    clear() {
        for (let i = 0; i < this.capacity; i++) {
            {
                this.pixels[i] = null;
            }
            ;
        }
        this.pixels = null;
        this.entries = null;
        this.recentlyUsed.clear();
        this.recentlyUsed = null;
    }
}
MonochromeImageCache.__static_initialized = false;
MonochromeImageCache["__class"] = "MonochromeImageCache";
class TextureOp37 extends TextureOp {
    constructor() {
        super(0, true);
        this.anInt4505 = 0;
        this.anInt4503 = 8192;
        this.anInt4508 = 2048;
        this.anInt4504 = 0;
        this.anInt4515 = 2048;
        this.anInt4507 = 12288;
        this.anInt4517 = 4096;
    }
    /*private*/ method3687(x, y) {
        const local9 = (y - x) * this.anInt4507 >> 12;
        let local24 = TextureOp.COSINE[local9 * 255 >> 12 & 255];
        local24 = ((local24 << 12) / this.anInt4507 | 0);
        local24 = ((local24 << 12) / this.anInt4503 | 0);
        local24 = this.anInt4517 * local24 >> 12;
        return local24 > x + y && -local24 < x + y;
    }
    /*private*/ method3690(x, y) {
        const local13 = (y + x) * this.anInt4507 >> 12;
        let local23 = TextureOp.COSINE[local13 * 255 >> 12 & 255];
        local23 = ((local23 << 12) / this.anInt4507 | 0);
        local23 = ((local23 << 12) / this.anInt4503 | 0);
        local23 = local23 * this.anInt4517 >> 12;
        return local23 > y - x && y - x > -local23;
    }
    postDecode() {
        TextureOp.createTrigonometryTables();
    }
    decode(buffer, code) {
        if (code === 0) {
            this.anInt4508 = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.anInt4505 = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.anInt4504 = buffer.readUnsignedShort();
        }
        else if (code === 3) {
            this.anInt4515 = buffer.readUnsignedShort();
        }
        else if (code === 4) {
            this.anInt4507 = buffer.readUnsignedShort();
        }
        else if (code === 5) {
            this.anInt4517 = buffer.readUnsignedShort();
        }
        else if (code === 6) {
            this.anInt4503 = buffer.readUnsignedShort();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local22 = Texture.normalisedY[y] - 2048;
            for (let x = 0; x < Texture.width; x++) {
                {
                    const local33 = Texture.normalisedX[x] - 2048;
                    let local38 = local33 + this.anInt4508;
                    local38 = local38 >= -2048 ? local38 : local38 + 4096;
                    let local53 = local22 + this.anInt4505;
                    local38 = local38 <= 2048 ? local38 : local38 - 4096;
                    local53 = local53 >= -2048 ? local53 : local53 + 4096;
                    local53 = local53 <= 2048 ? local53 : local53 - 4096;
                    let local87 = local33 + this.anInt4504;
                    let local92 = local22 + this.anInt4515;
                    local87 = local87 >= -2048 ? local87 : local87 + 4096;
                    local87 = local87 <= 2048 ? local87 : local87 - 4096;
                    local92 = local92 >= -2048 ? local92 : local92 + 4096;
                    local92 = local92 <= 2048 ? local92 : local92 - 4096;
                    dest[x] = this.method3687(local38, local53) || this.method3690(local87, local92) ? 4096 : 0;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOp37["__class"] = "TextureOp37";
class TextureOpBinary extends TextureOp {
    constructor() {
        super(1, true);
        this.minValue = 0;
        this.maxValue = 4096;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.minValue = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.maxValue = buffer.readUnsignedShort();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    const value = src[x];
                    dest[x] = value >= this.minValue && value <= this.maxValue ? 4096 : 0;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpBinary["__class"] = "TextureOpBinary";
class TextureOpBoxBlur extends TextureOp {
    constructor() {
        super(1, false);
        this.radiusY = 1;
        this.radiusX = 1;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const local32 = this.radiusY + this.radiusY + 1;
            const local36 = (65536 / local32 | 0);
            const local44 = this.radiusX + this.radiusX + 1;
            const local48 = (65536 / local44 | 0);
            const local51 = (s => { let a = []; while (s-- > 0)
                a.push(null); return a; })(local32);
            for (let local57 = y - this.radiusY; local57 <= y + this.radiusY; local57++) {
                {
                    const src = this.getChildColorOutput(0, local57 & Texture.heightMask);
                    const local80 = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                        return 0;
                    }
                    else {
                        let array = [];
                        for (let i = 0; i < dims[0]; i++) {
                            array.push(allocate(dims.slice(1)));
                        }
                        return array;
                    } }; return allocate(dims); })([3, Texture.width]);
                    let local82 = 0;
                    let local84 = 0;
                    const srcRed = src[0];
                    let local90 = 0;
                    const srcBlue = src[2];
                    const srcGreen = src[1];
                    for (let local102 = -this.radiusX; local102 <= this.radiusX; local102++) {
                        {
                            const local114 = Texture.widthMask & local102;
                            local90 += srcGreen[local114];
                            local82 += srcRed[local114];
                            local84 += srcBlue[local114];
                        }
                        ;
                    }
                    const local139 = local80[0];
                    const local143 = local80[1];
                    const local147 = local80[2];
                    let local149 = 0;
                    while ((Texture.width > local149)) {
                        {
                            local139[local149] = local48 * local82 >> 16;
                            local143[local149] = local90 * local48 >> 16;
                            local147[local149] = local48 * local84 >> 16;
                            let local184 = local149 - this.radiusX & Texture.widthMask;
                            const local190 = local90 - srcGreen[local184];
                            const local196 = local82 - srcRed[local184];
                            local149++;
                            const local203 = local84 - srcBlue[local184];
                            local184 = local149 + this.radiusX & Texture.widthMask;
                            local82 = local196 + srcRed[local184];
                            local90 = local190 + srcGreen[local184];
                            local84 = local203 + srcBlue[local184];
                        }
                    }
                    ;
                    local51[local57 + this.radiusY - y] = local80;
                }
                ;
            }
            const destGreen = dest[1];
            const destBlue = dest[2];
            const destRed = dest[0];
            for (let local259 = 0; local259 < Texture.width; local259++) {
                {
                    let local264 = 0;
                    let local266 = 0;
                    let local268 = 0;
                    for (let local270 = 0; local270 < local32; local270++) {
                        {
                            const local277 = local51[local270];
                            local268 += local277[2][local259];
                            local264 += local277[0][local259];
                            local266 += local277[1][local259];
                        }
                        ;
                    }
                    destRed[local259] = local36 * local264 >> 16;
                    destGreen[local259] = local36 * local266 >> 16;
                    destBlue[local259] = local268 * local36 >> 16;
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.radiusX = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.radiusY = buffer.readUnsignedByte();
        }
        else if (code === 2) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const windowY = this.radiusY + this.radiusY + 1;
            const windowYReciprocal = (65536 / windowY | 0);
            const windowX = this.radiusX + this.radiusX + 1;
            const windowXReciprocal = (65536 / windowX | 0);
            const horizontalAverages = (s => { let a = []; while (s-- > 0)
                a.push(null); return a; })(windowY);
            for (let y0 = y - this.radiusY; y0 <= y + this.radiusY; y0++) {
                {
                    const src = this.getChildMonochromeOutput(0, Texture.heightMask & y0);
                    const horizontalAverage = (s => { let a = []; while (s-- > 0)
                        a.push(0); return a; })(Texture.width);
                    let horizontalSum = 0;
                    for (let x0 = -this.radiusX; x0 <= this.radiusX; x0++) {
                        {
                            horizontalSum += src[x0 & Texture.widthMask];
                        }
                        ;
                    }
                    let x0 = 0;
                    while ((x0 < Texture.width)) {
                        {
                            horizontalAverage[x0] = horizontalSum * windowXReciprocal >> 16;
                            const local128 = horizontalSum - src[(x0 - this.radiusX) & Texture.widthMask];
                            x0++;
                            horizontalSum = local128 + src[Texture.widthMask & (x0 + this.radiusX)];
                        }
                    }
                    ;
                    horizontalAverages[y0 + this.radiusY - y] = horizontalAverage;
                }
                ;
            }
            for (let x0 = 0; x0 < Texture.width; x0++) {
                {
                    let verticalSum = 0;
                    for (let y0 = 0; y0 < windowY; y0++) {
                        {
                            verticalSum += horizontalAverages[y0][x0];
                        }
                        ;
                    }
                    dest[x0] = verticalSum * windowYReciprocal >> 16;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpBoxBlur["__class"] = "TextureOpBoxBlur";
class TextureOpBricks extends TextureOp {
    constructor() {
        super(0, true);
        if (this.anInt4937 === undefined) {
            this.anInt4937 = 0;
        }
        if (this.anIntArrayArray41 === undefined) {
            this.anIntArrayArray41 = null;
        }
        if (this.anInt4948 === undefined) {
            this.anInt4948 = 0;
        }
        if (this.anIntArray536 === undefined) {
            this.anIntArray536 = null;
        }
        if (this.anInt4949 === undefined) {
            this.anInt4949 = 0;
        }
        if (this.anIntArrayArray42 === undefined) {
            this.anIntArrayArray42 = null;
        }
        this.anInt4935 = 81;
        this.anInt4943 = 4;
        this.anInt4944 = 0;
        this.anInt4942 = 1024;
        this.anInt4941 = 1024;
        this.anInt4945 = 409;
        this.anInt4954 = 204;
        this.anInt4936 = 8;
    }
    /*private*/ method4057() {
        const random = new Random(this.anInt4936);
        this.anInt4937 = (4096 / this.anInt4936 | 0);
        this.anIntArray536 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(this.anInt4936 + 1);
        this.anIntArrayArray41 = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([this.anInt4936, this.anInt4943 + 1]);
        this.anIntArrayArray42 = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([this.anInt4936, this.anInt4943]);
        this.anIntArray536[0] = 0;
        this.anInt4949 = (4096 / this.anInt4943 | 0);
        const local57 = (this.anInt4949 / 2 | 0);
        this.anInt4948 = (this.anInt4935 / 2 | 0);
        const local68 = (this.anInt4937 / 2 | 0);
        for (let local74 = 0; local74 < this.anInt4936; local74++) {
            {
                if (local74 > 0) {
                    let local87 = this.anInt4937;
                    const local99 = (RandomUtils.nextInt(random, 4096) - 2048) * this.anInt4954 >> 12;
                    local87 += local99 * local68 >> 12;
                    this.anIntArray536[local74] = local87 + this.anIntArray536[local74 - 1];
                }
                this.anIntArrayArray41[local74][0] = 0;
                for (let local128 = 0; local128 < this.anInt4943; local128++) {
                    {
                        if (local128 > 0) {
                            let local139 = this.anInt4949;
                            const local153 = (RandomUtils.nextInt(random, 4096) - 2048) * this.anInt4945 >> 12;
                            local139 += local57 * local153 >> 12;
                            this.anIntArrayArray41[local74][local128] = this.anIntArrayArray41[local74][local128 - 1] + local139;
                        }
                        this.anIntArrayArray42[local74][local128] = this.anInt4941 <= 0 ? 4096 : 4096 - RandomUtils.nextInt(random, this.anInt4941);
                    }
                    ;
                }
                this.anIntArrayArray41[local74][this.anInt4943] = 4096;
            }
            ;
        }
        this.anIntArray536[this.anInt4936] = 4096;
    }
    postDecode() {
        this.method4057();
    }
    decode(buffer, code) {
        if (code === 0) {
            this.anInt4943 = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.anInt4936 = buffer.readUnsignedByte();
        }
        else if (code === 2) {
            this.anInt4945 = buffer.readUnsignedShort();
        }
        else if (code === 3) {
            this.anInt4954 = buffer.readUnsignedShort();
        }
        else if (code === 4) {
            this.anInt4942 = buffer.readUnsignedShort();
        }
        else if (code === 5) {
            this.anInt4944 = buffer.readUnsignedShort();
        }
        else if (code === 6) {
            this.anInt4935 = buffer.readUnsignedShort();
        }
        else if (code === 7) {
            this.anInt4941 = buffer.readUnsignedShort();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            let local19 = 0;
            let local26;
            for (local26 = this.anInt4944 + Texture.normalisedY[y]; local26 < 0; local26 += 4096) {
                {
                }
                ;
            }
            while ((local26 > 4096)) {
                {
                    local26 -= 4096;
                }
            }
            ;
            while ((this.anInt4936 > local19 && local26 >= this.anIntArray536[local19])) {
                {
                    local19++;
                }
            }
            ;
            const local64 = local19 - 1;
            const local69 = this.anIntArray536[local19];
            const local80 = (local19 & 1) === 0;
            const local87 = this.anIntArray536[local19 - 1];
            if (local87 + this.anInt4948 < local26 && local26 < local69 - this.anInt4948) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const local123 = local80 ? this.anInt4942 : -this.anInt4942;
                        let local135 = Texture.normalisedX[x] + (local123 * this.anInt4949 >> 12);
                        let local137 = 0;
                        while ((local135 < 0)) {
                            {
                                local135 += 4096;
                            }
                        }
                        ;
                        while ((local135 > 4096)) {
                            {
                                local135 -= 4096;
                            }
                        }
                        ;
                        while ((local137 < this.anInt4943 && local135 >= this.anIntArrayArray41[local64][local137])) {
                            {
                                local137++;
                            }
                        }
                        ;
                        const local175 = this.anIntArrayArray41[local64][local137];
                        const local179 = local137 - 1;
                        const local186 = this.anIntArrayArray41[local64][local179];
                        if (local186 + this.anInt4948 < local135 && local175 - this.anInt4948 > local135) {
                            dest[x] = this.anIntArrayArray42[local64][local179];
                        }
                        else {
                            dest[x] = 0;
                        }
                    }
                    ;
                }
            }
            else {
                ArrayUtils.fill$int_A$int$int$int(dest, 0, Texture.width, 0);
            }
        }
        return dest;
    }
}
TextureOpBricks["__class"] = "TextureOpBricks";
class TextureOpBrightness extends TextureOp {
    constructor() {
        super(1, false);
        this.maxValue = 409;
        this.redFactor = 4096;
        this.blueFactor = 4096;
        this.colorDelta = [0, 0, 0];
        this.greenFactor = 4096;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcRed = src[0];
            const srcGreen = src[1];
            const srcBlue = src[2];
            const destGreen = dest[1];
            const destRed = dest[0];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const r = srcRed[x];
                    let absR = r - this.colorDelta[0];
                    if (absR < 0) {
                        absR = -absR;
                    }
                    if (absR <= this.maxValue) {
                        const g = srcGreen[x];
                        let absG = g - this.colorDelta[1];
                        if (absG < 0) {
                            absG = -absG;
                        }
                        if (absG <= this.maxValue) {
                            const b = srcBlue[x];
                            let absB = b - this.colorDelta[2];
                            if (absB < 0) {
                                absB = -absB;
                            }
                            if (absB <= this.maxValue) {
                                destRed[x] = r * this.redFactor >> 12;
                                destGreen[x] = g * this.greenFactor >> 12;
                                destBlue[x] = b * this.blueFactor >> 12;
                            }
                            else {
                                destRed[x] = r;
                                destGreen[x] = g;
                                destBlue[x] = b;
                            }
                        }
                        else {
                            destRed[x] = r;
                            destGreen[x] = g;
                            destBlue[x] = srcBlue[x];
                        }
                    }
                    else {
                        destRed[x] = r;
                        destGreen[x] = srcGreen[x];
                        destBlue[x] = srcBlue[x];
                    }
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.maxValue = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.blueFactor = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.greenFactor = buffer.readUnsignedShort();
        }
        else if (code === 3) {
            this.redFactor = buffer.readUnsignedShort();
        }
        else if (code === 4) {
            const rgb = buffer.readUnsignedMedium();
            this.colorDelta[0] = (rgb & 16711680) << 4;
            this.colorDelta[2] = rgb >> 12 & 0;
            this.colorDelta[1] = rgb >> 4 & 4080;
        }
    }
}
TextureOpBrightness["__class"] = "TextureOpBrightness";
class TextureOpClamp extends TextureOp {
    constructor() {
        super(1, false);
        this.minValue = 0;
        this.maxValue = 4096;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.minValue = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.maxValue = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    const value = src[x];
                    if (value < this.minValue) {
                        dest[x] = this.minValue;
                    }
                    else if (value > this.maxValue) {
                        dest[x] = this.maxValue;
                    }
                    else {
                        dest[x] = value;
                    }
                }
                ;
            }
        }
        return dest;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcRed = src[0];
            const srcGreen = src[1];
            const destRed = dest[0];
            const srcBlue = src[2];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const green = srcGreen[x];
                    const red = srcRed[x];
                    const blue = srcBlue[x];
                    if (red < this.minValue) {
                        destRed[x] = this.minValue;
                    }
                    else if (red > this.maxValue) {
                        destRed[x] = this.maxValue;
                    }
                    else {
                        destRed[x] = red;
                    }
                    if (green < this.minValue) {
                        destGreen[x] = this.minValue;
                    }
                    else if (green > this.maxValue) {
                        destGreen[x] = this.maxValue;
                    }
                    else {
                        destGreen[x] = green;
                    }
                    if (blue < this.minValue) {
                        destBlue[x] = this.minValue;
                    }
                    else if (blue > this.maxValue) {
                        destBlue[x] = this.maxValue;
                    }
                    else {
                        destBlue[x] = blue;
                    }
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpClamp["__class"] = "TextureOpClamp";
class TextureOpColorEdgeDetector extends TextureOp {
    constructor() {
        super(1, false);
        this.anInt3634 = 4096;
        this.aBoolean263 = true;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.anInt3634 = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.aBoolean263 = buffer.readUnsignedByte() === 1;
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src0 = this.getChildMonochromeOutput(0, Texture.heightMask & y - 1);
            const src1 = this.getChildMonochromeOutput(0, y);
            const src2 = this.getChildMonochromeOutput(0, y + 1 & Texture.heightMask);
            const destRed = dest[0];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const dy = (src2[x] - src0[x]) * this.anInt3634;
                    const dx = this.anInt3634 * (src1[x + 1 & Texture.widthMask] - src1[x - 1 & Texture.widthMask]);
                    const dy0 = dy >> 12;
                    const dx0 = dx >> 12;
                    const dySquared = dy0 * dy0 >> 12;
                    const dxSquared = dx0 * dx0 >> 12;
                    const local137 = ((Math.sqrt(Math.fround((dySquared + dxSquared + 4096) / 4096.0)) * 4096.0) | 0);
                    let red;
                    let green;
                    let blue;
                    if (local137 === 0) {
                        green = 0;
                        blue = 0;
                        red = 0;
                    }
                    else {
                        green = (dy / local137 | 0);
                        blue = (16777216 / local137 | 0);
                        red = (dx / local137 | 0);
                    }
                    if (this.aBoolean263) {
                        red = (red >> 1) + 2048;
                        green = (green >> 1) + 2048;
                        blue = (blue >> 1) + 2048;
                    }
                    destRed[x] = red;
                    destGreen[x] = green;
                    destBlue[x] = blue;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpColorEdgeDetector["__class"] = "TextureOpColorEdgeDetector";
class TextureOpColorFill extends TextureOp {
    constructor(color) {
        if (((typeof color === 'number') || color === null)) {
            let __args = arguments;
            super(0, false);
            if (this.blue === undefined) {
                this.blue = 0;
            }
            if (this.green === undefined) {
                this.green = 0;
            }
            if (this.red === undefined) {
                this.red = 0;
            }
            this.setColor(color);
        }
        else if (color === undefined) {
            let __args = arguments;
            {
                let __args = arguments;
                let color = 0;
                super(0, false);
                if (this.blue === undefined) {
                    this.blue = 0;
                }
                if (this.green === undefined) {
                    this.green = 0;
                }
                if (this.red === undefined) {
                    this.red = 0;
                }
                this.setColor(color);
            }
            if (this.blue === undefined) {
                this.blue = 0;
            }
            if (this.green === undefined) {
                this.green = 0;
            }
            if (this.red === undefined) {
                this.red = 0;
            }
        }
        else
            throw new Error('invalid overload');
    }
    decode(buffer, code) {
        if (code === 0) {
            this.setColor(buffer.readUnsignedMedium());
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const green = dest[1];
            const red = dest[0];
            const blue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    red[x] = this.red;
                    green[x] = this.green;
                    blue[x] = this.blue;
                }
                ;
            }
        }
        return dest;
    }
    /*private*/ setColor(color) {
        this.green = color >> 4 & 4080;
        this.red = color >> 12 & 4080;
        this.blue = (color & 255) << 4;
    }
}
TextureOpColorFill["__class"] = "TextureOpColorFill";
class TextureOpColorGradient extends TextureOp {
    constructor() {
        super(1, false);
        if (this.samples === undefined) {
            this.samples = null;
        }
        this.colors = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(257);
    }
    /*private*/ setPreset(preset) {
        if (preset === 0) {
            return;
        }
        if (preset === 1) {
            this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([2, 4]);
            this.samples[0][0] = 0;
            this.samples[0][3] = 0;
            this.samples[0][1] = 0;
            this.samples[1][0] = 4096;
            this.samples[0][2] = 0;
            this.samples[1][2] = 4096;
            this.samples[1][1] = 4096;
            this.samples[1][3] = 4096;
        }
        else if (preset === 2) {
            this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([8, 4]);
            this.samples[0][0] = 0;
            this.samples[0][1] = 2650;
            this.samples[0][2] = 2602;
            this.samples[1][0] = 2867;
            this.samples[2][0] = 3072;
            this.samples[1][2] = 1799;
            this.samples[1][1] = 2313;
            this.samples[2][2] = 1734;
            this.samples[3][2] = 1220;
            this.samples[4][2] = 963;
            this.samples[0][3] = 2361;
            this.samples[5][2] = 2152;
            this.samples[3][0] = 3276;
            this.samples[2][1] = 2618;
            this.samples[6][2] = 1060;
            this.samples[4][0] = 3481;
            this.samples[1][3] = 1558;
            this.samples[7][2] = 1413;
            this.samples[5][0] = 3686;
            this.samples[6][0] = 3891;
            this.samples[7][0] = 4096;
            this.samples[3][1] = 2296;
            this.samples[2][3] = 1413;
            this.samples[3][3] = 947;
            this.samples[4][1] = 2072;
            this.samples[5][1] = 2730;
            this.samples[6][1] = 2232;
            this.samples[7][1] = 1686;
            this.samples[4][3] = 722;
            this.samples[5][3] = 1766;
            this.samples[6][3] = 915;
            this.samples[7][3] = 1140;
        }
        else if (preset === 3) {
            this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([7, 4]);
            this.samples[0][3] = 4096;
            this.samples[0][2] = 0;
            this.samples[1][3] = 4096;
            this.samples[2][3] = 0;
            this.samples[0][0] = 0;
            this.samples[3][3] = 0;
            this.samples[4][3] = 0;
            this.samples[1][2] = 4096;
            this.samples[2][2] = 4096;
            this.samples[5][3] = 4096;
            this.samples[3][2] = 4096;
            this.samples[0][1] = 0;
            this.samples[1][0] = 663;
            this.samples[1][1] = 0;
            this.samples[6][3] = 4096;
            this.samples[2][1] = 0;
            this.samples[4][2] = 0;
            this.samples[5][2] = 0;
            this.samples[2][0] = 1363;
            this.samples[3][0] = 2048;
            this.samples[3][1] = 4096;
            this.samples[4][0] = 2727;
            this.samples[6][2] = 0;
            this.samples[4][1] = 4096;
            this.samples[5][0] = 3411;
            this.samples[6][0] = 4096;
            this.samples[5][1] = 4096;
            this.samples[6][1] = 0;
        }
        else if (preset === 4) {
            this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([6, 4]);
            this.samples[0][0] = 0;
            this.samples[0][1] = 0;
            this.samples[0][2] = 0;
            this.samples[1][2] = 0;
            this.samples[0][3] = 0;
            this.samples[1][0] = 1843;
            this.samples[1][1] = 0;
            this.samples[2][0] = 2457;
            this.samples[1][3] = 1493;
            this.samples[2][1] = 0;
            this.samples[3][1] = 0;
            this.samples[2][2] = 0;
            this.samples[3][2] = 1124;
            this.samples[3][0] = 2781;
            this.samples[2][3] = 2939;
            this.samples[3][3] = 3565;
            this.samples[4][0] = 3481;
            this.samples[5][0] = 4096;
            this.samples[4][3] = 4031;
            this.samples[4][2] = 3084;
            this.samples[4][1] = 546;
            this.samples[5][2] = 4096;
            this.samples[5][3] = 4096;
            this.samples[5][1] = 4096;
        }
        else if (preset === 5) {
            this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([16, 4]);
            this.samples[0][2] = 192;
            this.samples[0][1] = 80;
            this.samples[0][3] = 321;
            this.samples[0][0] = 0;
            this.samples[1][2] = 449;
            this.samples[1][1] = 321;
            this.samples[2][1] = 578;
            this.samples[1][3] = 562;
            this.samples[2][2] = 690;
            this.samples[2][3] = 803;
            this.samples[3][3] = 1140;
            this.samples[3][1] = 947;
            this.samples[3][2] = 995;
            this.samples[1][0] = 155;
            this.samples[2][0] = 389;
            this.samples[3][0] = 671;
            this.samples[4][2] = 1397;
            this.samples[5][2] = 1429;
            this.samples[4][0] = 897;
            this.samples[4][3] = 1509;
            this.samples[6][2] = 1461;
            this.samples[5][3] = 1413;
            this.samples[4][1] = 1285;
            this.samples[6][3] = 1333;
            this.samples[5][0] = 1175;
            this.samples[7][3] = 1702;
            this.samples[8][3] = 2056;
            this.samples[6][0] = 1368;
            this.samples[9][3] = 2666;
            this.samples[10][3] = 3276;
            this.samples[5][1] = 1525;
            this.samples[7][0] = 1507;
            this.samples[7][2] = 1525;
            this.samples[6][1] = 1734;
            this.samples[11][3] = 3228;
            this.samples[8][0] = 1736;
            this.samples[9][0] = 2088;
            this.samples[7][1] = 1413;
            this.samples[8][2] = 1590;
            this.samples[9][2] = 2056;
            this.samples[8][1] = 1108;
            this.samples[10][0] = 2355;
            this.samples[9][1] = 1766;
            this.samples[11][0] = 2691;
            this.samples[10][1] = 2409;
            this.samples[12][0] = 3031;
            this.samples[13][0] = 3522;
            this.samples[10][2] = 2586;
            this.samples[11][1] = 3116;
            this.samples[11][2] = 3148;
            this.samples[12][3] = 3196;
            this.samples[14][0] = 3727;
            this.samples[15][0] = 4096;
            this.samples[12][2] = 3710;
            this.samples[13][3] = 3019;
            this.samples[13][2] = 3421;
            this.samples[12][1] = 3806;
            this.samples[14][3] = 3228;
            this.samples[15][3] = 2746;
            this.samples[13][1] = 3437;
            this.samples[14][1] = 3116;
            this.samples[15][1] = 2377;
            this.samples[14][2] = 3148;
            this.samples[15][2] = 2505;
        }
        else if (preset === 6) {
            this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([4, 4]);
            this.samples[0][3] = 0;
            this.samples[0][1] = 0;
            this.samples[1][3] = 0;
            this.samples[0][2] = 4096;
            this.samples[1][2] = 4096;
            this.samples[2][3] = 0;
            this.samples[2][2] = 4096;
            this.samples[0][0] = 2048;
            this.samples[3][3] = 0;
            this.samples[1][1] = 4096;
            this.samples[3][2] = 0;
            this.samples[1][0] = 2867;
            this.samples[2][1] = 4096;
            this.samples[3][1] = 4096;
            this.samples[2][0] = 3276;
            this.samples[3][0] = 4096;
        }
        else {
            throw Object.defineProperty(new Error("Invalid gradient preset"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
        }
    }
    /*private*/ interpolate() {
        const samplesLen = this.samples.length;
        if (samplesLen <= 0) {
            return;
        }
        for (let i = 0; i < 257; i++) {
            {
                let sample = 0;
                const position = i << 4;
                for (let j = 0; j < samplesLen && position >= this.samples[j][0]; j++) {
                    {
                        sample++;
                    }
                    ;
                }
                let red;
                let green;
                let blue;
                if (sample >= samplesLen) {
                    const lastSample = this.samples[samplesLen - 1];
                    blue = lastSample[3];
                    red = lastSample[1];
                    green = lastSample[2];
                }
                else {
                    const nextSample = this.samples[sample];
                    if (sample <= 0) {
                        green = nextSample[2];
                        red = nextSample[1];
                        blue = nextSample[3];
                    }
                    else {
                        const prevSample = this.samples[sample - 1];
                        const nextWeight = ((position - prevSample[0] << 12) / (nextSample[0] - prevSample[0]) | 0);
                        const prevWeight = 4096 - nextWeight;
                        green = nextSample[2] * nextWeight + prevSample[2] * prevWeight >> 12;
                        red = nextSample[1] * nextWeight + prevSample[1] * prevWeight >> 12;
                        blue = nextSample[3] * nextWeight + prevSample[3] * prevWeight >> 12;
                    }
                }
                let green2 = green >> 4;
                if (green2 < 0) {
                    green2 = 0;
                }
                else if (green2 > 255) {
                    green2 = 255;
                }
                let blue2 = blue >> 4;
                let red2 = red >> 4;
                if (red2 < 0) {
                    red2 = 0;
                }
                else if (red2 > 255) {
                    red2 = 255;
                }
                if (blue2 < 0) {
                    blue2 = 0;
                }
                else if (blue2 > 255) {
                    blue2 = 255;
                }
                this.colors[i] = blue2 | green2 << 8 | red2 << 16;
            }
            ;
        }
    }
    postDecode() {
        if (this.samples == null) {
            this.setPreset(1);
        }
        this.interpolate();
    }
    decode(buffer, code) {
        if (code !== 0) {
            return;
        }
        const preset = buffer.readUnsignedByte();
        if (preset !== 0) {
            this.setPreset(preset);
            return;
        }
        this.samples = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([buffer.readUnsignedByte(), 4]);
        for (let i = 0; i < this.samples.length; i++) {
            {
                this.samples[i][0] = buffer.readUnsignedShort();
                this.samples[i][1] = buffer.readUnsignedByte() << 4;
                this.samples[i][2] = buffer.readUnsignedByte() << 4;
                this.samples[i][3] = buffer.readUnsignedByte() << 4;
            }
            ;
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, y);
            const green = dest[1];
            const blue = dest[2];
            const red = dest[0];
            for (let x = 0; x < Texture.width; x++) {
                {
                    let value = src[x] >> 4;
                    if (value < 0) {
                        value = 0;
                    }
                    if (value > 256) {
                        value = 256;
                    }
                    const color = this.colors[value];
                    red[x] = color >> 12 & 4080;
                    green[x] = color >> 4 & 4080;
                    blue[x] = (color & 255) << 4;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpColorGradient["__class"] = "TextureOpColorGradient";
class TextureOpColorize extends TextureOp {
    constructor() {
        super(1, false);
        this.green = 4096;
        this.red = 4096;
        this.blue = 4096;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.red = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.green = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.blue = buffer.readUnsignedShort();
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcGreen = src[1];
            const srcRed = src[0];
            const destRed = dest[0];
            const destGreen = dest[1];
            const srcBlue = src[2];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const red = srcRed[x];
                    const blue = srcBlue[x];
                    const green = srcGreen[x];
                    if (red === blue && blue === green) {
                        destRed[x] = this.red * red >> 12;
                        destGreen[x] = this.green * blue >> 12;
                        destBlue[x] = this.blue * green >> 12;
                    }
                    else {
                        destRed[x] = this.red;
                        destGreen[x] = this.green;
                        destBlue[x] = this.blue;
                    }
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpColorize["__class"] = "TextureOpColorize";
class TextureOpCombine extends TextureOp {
    constructor() {
        super(2, false);
        this.function = 6;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.function = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src0 = this.getChildMonochromeOutput(0, y);
            const src1 = this.getChildMonochromeOutput(1, y);
            const __function = this.function;
            if (__function === 1) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        dest[x] = src1[x] + src0[x];
                    }
                    ;
                }
            }
            else if (__function === 2) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        dest[x] = src0[x] - src1[x];
                    }
                    ;
                }
            }
            else if (__function === 3) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        dest[x] = src0[x] * src1[x] >> 12;
                    }
                    ;
                }
            }
            else if (__function === 4) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value1 = src1[x];
                        dest[x] = value1 === 0 ? 4096 : ((src0[x] << 12) / value1 | 0);
                    }
                    ;
                }
            }
            else if (__function === 5) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        dest[x] = 4096 - ((4096 - src0[x]) * (4096 - src1[x]) >> 12);
                    }
                    ;
                }
            }
            else if (__function === 6) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value1 = src1[x];
                        dest[x] = value1 >= 2048 ? 4096 - ((4096 - value1) * (4096 - src0[x]) >> 11) : value1 * src0[x] >> 11;
                    }
                    ;
                }
            }
            else if (__function === 7) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value0 = src0[x];
                        dest[x] = value0 === 4096 ? 4096 : ((src1[x] << 12) / (4096 - value0) | 0);
                    }
                    ;
                }
            }
            else if (__function === 8) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value = src0[x];
                        dest[x] = value === 0 ? 0 : 4096 - ((4096 - src1[x] << 12) / value | 0);
                    }
                    ;
                }
            }
            else if (__function === 9) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value0 = src0[x];
                        const value1 = src1[x];
                        dest[x] = value0 < value1 ? value0 : value1;
                    }
                    ;
                }
            }
            else if (__function === 10) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value0 = src0[x];
                        const value1 = src1[x];
                        dest[x] = value0 <= value1 ? value1 : value0;
                    }
                    ;
                }
            }
            else if (__function === 11) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value1 = src1[x];
                        const value0 = src0[x];
                        dest[x] = value0 > value1 ? value0 - value1 : value1 - value0;
                    }
                    ;
                }
            }
            else if (__function === 12) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const value0 = src0[x];
                        const value1 = src1[x];
                        dest[x] = value0 + value1 - (value0 * value1 >> 11);
                    }
                    ;
                }
            }
        }
        return dest;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src0 = this.getChildColorOutput(0, y);
            const src1 = this.getChildColorOutput(1, y);
            const destRed = dest[0];
            const destGreen = dest[1];
            const src0Red = src0[0];
            const destBlue = dest[2];
            const src0Green = src0[1];
            const src1Blue = src1[2];
            const src0Blue = src0[2];
            const src1Green = src1[1];
            const src1Red = src1[0];
            const __function = this.function;
            if (__function === 1) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = src0Red[x] + src1Red[x];
                        destGreen[x] = src0Green[x] + src1Green[x];
                        destBlue[x] = src0Blue[x] + src1Blue[x];
                    }
                    ;
                }
            }
            else if (__function === 2) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = src0Red[x] - src1Red[x];
                        destGreen[x] = src0Green[x] - src1Green[x];
                        destBlue[x] = src0Blue[x] - src1Blue[x];
                    }
                    ;
                }
            }
            else if (__function === 3) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = src0Red[x] * src1Red[x] >> 12;
                        destGreen[x] = src1Green[x] * src0Green[x] >> 12;
                        destBlue[x] = src1Blue[x] * src0Blue[x] >> 12;
                    }
                    ;
                }
            }
            else if (__function === 4) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const green1 = src1Green[x];
                        const red1 = src1Red[x];
                        const blue1 = src1Blue[x];
                        destRed[x] = red1 === 0 ? 4096 : ((src0Red[x] << 12) / red1 | 0);
                        destGreen[x] = green1 === 0 ? 4096 : ((src0Green[x] << 12) / green1 | 0);
                        destBlue[x] = blue1 === 0 ? 4096 : ((src0Blue[x] << 12) / blue1 | 0);
                    }
                    ;
                }
            }
            else if (__function === 5) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = 4096 - ((4096 - src0Red[x]) * (4096 - src1Red[x]) >> 12);
                        destGreen[x] = 4096 - ((4096 - src0Green[x]) * (4096 - src1Green[x]) >> 12);
                        destBlue[x] = 4096 - ((4096 - src0Blue[x]) * (4096 - src1Blue[x]) >> 12);
                    }
                    ;
                }
            }
            else if (__function === 6) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const green1 = src1Green[x];
                        const red1 = src1Red[x];
                        const blue1 = src1Blue[x];
                        destRed[x] = red1 >= 2048 ? 4096 - ((4096 - src0Red[x]) * (4096 - red1) >> 11) : red1 * src0Red[x] >> 11;
                        destGreen[x] = green1 >= 2048 ? 4096 - ((4096 - src0Green[x]) * (4096 - green1) >> 11) : src0Green[x] * green1 >> 11;
                        destBlue[x] = blue1 >= 2048 ? 4096 - ((4096 - src0Blue[x]) * (4096 - blue1) >> 11) : src0Blue[x] * blue1 >> 11;
                    }
                    ;
                }
            }
            else if (__function === 7) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const blue0 = src0Blue[x];
                        const green0 = src0Green[x];
                        const red0 = src0Red[x];
                        destRed[x] = red0 === 4096 ? 4096 : ((src1Red[x] << 12) / (4096 - red0) | 0);
                        destGreen[x] = green0 === 4096 ? 4096 : ((src1Green[x] << 12) / (4096 - green0) | 0);
                        destBlue[x] = blue0 === 4096 ? 4096 : ((src1Blue[x] << 12) / (4096 - blue0) | 0);
                    }
                    ;
                }
            }
            else if (__function === 8) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const green0 = src0Green[x];
                        const blue0 = src0Blue[x];
                        const red0 = src0Red[x];
                        destRed[x] = red0 === 0 ? 0 : 4096 - ((4096 - src1Red[x] << 12) / red0 | 0);
                        destGreen[x] = green0 === 0 ? 0 : 4096 - ((4096 - src1Green[x] << 12) / green0 | 0);
                        destBlue[x] = blue0 === 0 ? 0 : 4096 - ((4096 - src1Blue[x] << 12) / blue0 | 0);
                    }
                    ;
                }
            }
            else if (__function === 9) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const blue0 = src0Blue[x];
                        const blue1 = src1Blue[x];
                        const green1 = src1Green[x];
                        const red1 = src1Red[x];
                        const red0 = src0Red[x];
                        const green0 = src0Green[x];
                        destRed[x] = red0 < red1 ? red0 : red1;
                        destGreen[x] = green0 < green1 ? green0 : green1;
                        destBlue[x] = blue0 < blue1 ? blue0 : blue1;
                    }
                    ;
                }
            }
            else if (__function === 10) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const red0 = src0Red[x];
                        const blue0 = src0Blue[x];
                        const blue1 = src1Blue[x];
                        const red1 = src1Red[x];
                        const green1 = src1Green[x];
                        const green0 = src0Green[x];
                        destRed[x] = red0 > red1 ? red0 : red1;
                        destGreen[x] = green0 > green1 ? green0 : green1;
                        destBlue[x] = blue0 > blue1 ? blue0 : blue1;
                    }
                    ;
                }
            }
            else if (__function === 11) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const red1 = src1Red[x];
                        const green1 = src1Green[x];
                        const blue0 = src0Blue[x];
                        const blue1 = src1Blue[x];
                        const red0 = src0Red[x];
                        const green0 = src0Green[x];
                        destRed[x] = red0 <= red1 ? red1 - red0 : red0 - red1;
                        destGreen[x] = green0 <= green1 ? green1 - green0 : green0 - green1;
                        destBlue[x] = blue0 <= blue1 ? blue1 - blue0 : blue0 - blue1;
                    }
                    ;
                }
            }
            else if (__function === 12) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const green0 = src0Green[x];
                        const blue0 = src0Blue[x];
                        const red1 = src1Red[x];
                        const blue1 = src1Blue[x];
                        const red0 = src0Red[x];
                        const green1 = src1Green[x];
                        destRed[x] = red1 + red0 - (red0 * red1 >> 11);
                        destGreen[x] = green0 + green1 - (green0 * green1 >> 11);
                        destBlue[x] = blue0 + blue1 - (blue0 * blue1 >> 11);
                    }
                    ;
                }
            }
        }
        return dest;
    }
}
TextureOpCombine["__class"] = "TextureOpCombine";
class TextureOpCurve extends TextureOp {
    constructor() {
        super(1, true);
        if (this.markers === undefined) {
            this.markers = null;
        }
        if (this.firstMarker === undefined) {
            this.firstMarker = null;
        }
        if (this.lastMarker === undefined) {
            this.lastMarker = null;
        }
        this.aShortArray73 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(257);
        this.anInt3819 = 0;
    }
    /*private*/ getMarker(index) {
        if (index < 0) {
            return this.firstMarker;
        }
        else if (index < this.markers.length) {
            return this.markers[index];
        }
        else {
            return this.lastMarker;
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    let local43 = src[x] >> 4;
                    if (local43 < 0) {
                        local43 = 0;
                    }
                    if (local43 > 256) {
                        local43 = 256;
                    }
                    dest[x] = this.aShortArray73[local43];
                }
                ;
            }
        }
        return dest;
    }
    /*private*/ method3182() {
        const local13 = this.anInt3819;
        if (local13 === 2) {
            for (let local28 = 0; local28 < 257; local28++) {
                {
                    const local35 = local28 << 4;
                    let local37;
                    for (local37 = 1; local37 < this.markers.length - 1 && local35 >= this.markers[local37][0]; local37++) {
                        {
                        }
                        ;
                    }
                    const local62 = this.markers[local37];
                    const local69 = this.markers[local37 - 1];
                    const local78 = this.getMarker(local37 - 2)[1];
                    const local82 = local62[1];
                    const local86 = local69[1];
                    const local92 = local82 - local78;
                    const local101 = this.getMarker(local37 + 1)[1];
                    const local118 = ((local35 - local69[0] << 12) / (local62[0] - local69[0]) | 0);
                    const local128 = local101 + local86 - local78 - local82;
                    const local135 = local78 - local86 - local128;
                    const local141 = local118 * local118 >> 12;
                    const local147 = local118 * local92 >> 12;
                    const local157 = (local118 * local128 >> 12) * local141 >> 12;
                    const local163 = local141 * local135 >> 12;
                    let local172 = local157 + local163 + local147 + local86;
                    if (local172 <= -32768) {
                        local172 = -32767;
                    }
                    if (local172 >= 32768) {
                        local172 = 32767;
                    }
                    this.aShortArray73[local28] = (local172 | 0);
                }
                ;
            }
        }
        else if (local13 === 1) {
            for (let local200 = 0; local200 < 257; local200++) {
                {
                    const local207 = local200 << 4;
                    let local209;
                    for (local209 = 1; this.markers.length - 1 > local209 && this.markers[local209][0] <= local207; local209++) {
                        {
                        }
                        ;
                    }
                    const local238 = this.markers[local209 - 1];
                    const local243 = this.markers[local209];
                    const local261 = ((local207 - local238[0] << 12) / (local243[0] - local238[0]) | 0);
                    const local274 = 4096 - TextureOp.COSINE[local261 >> 5 & 255] >> 1;
                    const local279 = 4096 - local274;
                    let local293 = local274 * local243[1] + local279 * local238[1] >> 12;
                    if (local293 <= -32768) {
                        local293 = -32767;
                    }
                    if (local293 >= 32768) {
                        local293 = 32767;
                    }
                    this.aShortArray73[local200] = (local293 | 0);
                }
                ;
            }
        }
        else {
            for (let local320 = 0; local320 < 257; local320++) {
                {
                    const local327 = local320 << 4;
                    let local329;
                    for (local329 = 1; this.markers.length - 1 > local329 && local327 >= this.markers[local329][0]; local329++) {
                        {
                        }
                        ;
                    }
                    const local362 = this.markers[local329 - 1];
                    const local367 = this.markers[local329];
                    const local384 = ((local327 - local362[0] << 12) / (local367[0] - local362[0]) | 0);
                    const local389 = 4096 - local384;
                    let local403 = local367[1] * local384 + local389 * local362[1] >> 12;
                    if (local403 <= -32768) {
                        local403 = -32767;
                    }
                    if (local403 >= 32768) {
                        local403 = 32767;
                    }
                    this.aShortArray73[local320] = (local403 | 0);
                }
                ;
            }
        }
    }
    /*private*/ method3183() {
        const local8 = this.markers[0];
        const local13 = this.markers[1];
        const local22 = this.markers[this.markers.length - 1];
        const local31 = this.markers[this.markers.length - 2];
        this.lastMarker = [local31[0] + local31[0] - local22[0], local31[1] + local31[1] - local22[1]];
        this.firstMarker = [local8[0] + local8[0] - local13[0], local8[1] + local8[1] - local13[1]];
    }
    postDecode() {
        if (this.markers == null) {
            this.markers = [[0, 0], [4096, 4096]];
        }
        if (this.markers.length < 2) {
            throw Object.defineProperty(new Error("Curve operation requires at least two markers"), '__classes', { configurable: true, value: ['java.lang.Throwable', 'java.lang.Object', 'java.lang.RuntimeException', 'java.lang.Exception'] });
        }
        if (this.anInt3819 === 2) {
            this.method3183();
        }
        TextureOp.createTrigonometryTables();
        this.method3182();
    }
    decode(buffer, code) {
        if (code !== 0) {
            return;
        }
        this.anInt3819 = buffer.readUnsignedByte();
        this.markers = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([buffer.readUnsignedByte(), 2]);
        for (let i = 0; i < this.markers.length; i++) {
            {
                this.markers[i][0] = buffer.readUnsignedShort();
                this.markers[i][1] = buffer.readUnsignedShort();
            }
            ;
        }
    }
}
TextureOpCurve["__class"] = "TextureOpCurve";
class TextureOpEmboss extends TextureOp {
    constructor() {
        super(1, true);
        this.azimuth = 3216;
        this.elevation = 3216;
        this.depth = 4096;
        this.anIntArray57 = [0, 0, 0];
    }
    decode(buffer, code) {
        if (code === 0) {
            this.depth = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.azimuth = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.elevation = buffer.readUnsignedShort();
        }
    }
    postDecode() {
        this.method642();
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local24 = Texture.widthTimes32 * this.depth >> 12;
            const local36 = this.getChildMonochromeOutput(0, y - 1 & Texture.heightMask);
            const local44 = this.getChildMonochromeOutput(0, y);
            const local56 = this.getChildMonochromeOutput(0, Texture.heightMask & y + 1);
            for (let x = 0; x < Texture.width; x++) {
                {
                    const local82 = local24 * (local44[Texture.widthMask & x - 1] - local44[Texture.widthMask & x + 1]) >> 12;
                    let local86 = local82 >> 4;
                    const local99 = (local56[x] - local36[x]) * local24 >> 12;
                    if (local86 < 0) {
                        local86 = -local86;
                    }
                    let local112 = local99 >> 4;
                    if (local112 < 0) {
                        local112 = -local112;
                    }
                    if (local112 > 255) {
                        local112 = 255;
                    }
                    if (local86 > 255) {
                        local86 = 255;
                    }
                    const local149 = TextureMathUtils.INVERSE_SQUARE_ROOT_$LI$()[local86 + ((local112 + 1) * local112 >> 1)] & 255;
                    let local155 = local82 * local149 >> 8;
                    let local161 = local149 * local99 >> 8;
                    local155 = this.anIntArray57[0] * local155 >> 12;
                    let local176 = local149 * 4096 >> 8;
                    local161 = this.anIntArray57[1] * local161 >> 12;
                    local176 = this.anIntArray57[2] * local176 >> 12;
                    dest[x] = local176 + local161 + local155;
                }
                ;
            }
        }
        return dest;
    }
    /*private*/ method642() {
        const local11 = Math.cos((Math.fround(this.elevation / 4096.0)));
        this.anIntArray57[0] = ((Math.sin((Math.fround(this.azimuth / 4096.0))) * 4096.0 * local11) | 0);
        this.anIntArray57[1] = ((Math.cos((Math.fround(this.azimuth / 4096.0))) * local11 * 4096.0) | 0);
        this.anIntArray57[2] = ((Math.sin((Math.fround(this.elevation / 4096.0))) * 4096.0) | 0);
        const local69 = this.anIntArray57[0] * this.anIntArray57[0] >> 12;
        const local81 = this.anIntArray57[2] * this.anIntArray57[2] >> 12;
        const local93 = this.anIntArray57[1] * this.anIntArray57[1] >> 12;
        const local106 = ((Math.sqrt((local81 + local69 + local93 >> 12)) * 4096.0) | 0);
        if (local106 !== 0) {
            this.anIntArray57[0] = ((this.anIntArray57[0] << 12) / local106 | 0);
            this.anIntArray57[2] = ((this.anIntArray57[2] << 12) / local106 | 0);
            this.anIntArray57[1] = ((this.anIntArray57[1] << 12) / local106 | 0);
        }
    }
}
TextureOpEmboss["__class"] = "TextureOpEmboss";
class TextureOpFlip extends TextureOp {
    constructor() {
        super(1, false);
        this.flipVertical = true;
        this.flipHorizontal = true;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, this.flipVertical ? Texture.heightMask - y : y);
            if (this.flipHorizontal) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        dest[x] = src[Texture.widthMask - x];
                    }
                    ;
                }
            }
            else {
                ArrayUtils.copy$int_A$int$int_A$int$int(src, 0, dest, 0, Texture.width);
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.flipHorizontal = buffer.readUnsignedByte() === 1;
        }
        else if (code === 1) {
            this.flipVertical = buffer.readUnsignedByte() === 1;
        }
        else if (code === 2) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, this.flipVertical ? Texture.heightMask - y : y);
            const srcRed = src[0];
            const srcGreen = src[1];
            const destRed = dest[0];
            const srcBlue = src[2];
            const destGreen = dest[1];
            const destBlue = dest[2];
            if (this.flipHorizontal) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = srcRed[Texture.widthMask - x];
                        destGreen[x] = srcGreen[Texture.widthMask - x];
                        destBlue[x] = srcBlue[Texture.widthMask - x];
                    }
                    ;
                }
            }
            else {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = srcRed[x];
                        destGreen[x] = srcGreen[x];
                        destBlue[x] = srcBlue[x];
                    }
                    ;
                }
            }
        }
        return dest;
    }
}
TextureOpFlip["__class"] = "TextureOpFlip";
class TextureOpHerringbone extends TextureOp {
    constructor() {
        super(0, true);
        this.scaleX = 1;
        this.ratio = 204;
        this.scaleY = 1;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            for (let x = 0; x < Texture.width; x++) {
                {
                    const normalisedX = Texture.normalisedX[x];
                    let local40 = normalisedX * this.scaleX >> 12;
                    const normalisedY = Texture.normalisedY[y];
                    const local51 = normalisedY * this.scaleY >> 12;
                    const local61 = this.scaleX * (normalisedX % ((4096 / this.scaleX | 0)));
                    const local71 = normalisedY % ((4096 / this.scaleY | 0)) * this.scaleY;
                    if (local71 < this.ratio) {
                        for (local40 -= local51; local40 < 0; local40 += 4) {
                            {
                            }
                            ;
                        }
                        while ((local40 > 3)) {
                            {
                                local40 -= 4;
                            }
                        }
                        ;
                        if (local40 !== 1) {
                            dest[x] = 0;
                            continue;
                        }
                        if (local61 < this.ratio) {
                            dest[x] = 0;
                            continue;
                        }
                    }
                    if (local61 < this.ratio) {
                        let local131;
                        for (local131 = local40 - local51; local131 < 0; local131 += 4) {
                            {
                            }
                            ;
                        }
                        while ((local131 > 3)) {
                            {
                                local131 -= 4;
                            }
                        }
                        ;
                        if (local131 > 0) {
                            dest[x] = 0;
                            continue;
                        }
                    }
                    dest[x] = 4096;
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.scaleX = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.scaleY = buffer.readUnsignedByte();
        }
        else if (code === 2) {
            this.ratio = buffer.readUnsignedShort();
        }
    }
}
TextureOpHerringbone["__class"] = "TextureOpHerringbone";
class TextureOpHorizontalGradient extends TextureOp {
    constructor() {
        super(0, true);
    }
    getMonochromeOutput(y) {
        return Texture.normalisedX;
    }
}
TextureOpHorizontalGradient["__class"] = "TextureOpHorizontalGradient";
class TextureOpHslAdjust extends TextureOp {
    constructor() {
        super(1, false);
        if (this.red === undefined) {
            this.red = 0;
        }
        if (this.green === undefined) {
            this.green = 0;
        }
        if (this.hue === undefined) {
            this.hue = 0;
        }
        if (this.lightness === undefined) {
            this.lightness = 0;
        }
        if (this.saturation === undefined) {
            this.saturation = 0;
        }
        if (this.blue === undefined) {
            this.blue = 0;
        }
        this.lightnessDelta = 0;
        this.hueDelta = 0;
        this.saturationDelta = 0;
    }
    /*private*/ hslToRgb(h, s, l) {
        const q = l > 2048 ? s + l - (l * s >> 12) : l * (s + 4096) >> 12;
        if (q <= 0) {
            this.red = this.green = this.blue = l;
            return;
        }
        const p = l + l - q;
        const local47 = ((q - p << 12) / q | 0);
        h *= 6;
        const hPrime = h >> 12;
        const local64 = h - (hPrime << 12);
        let local70 = local47 * q >> 12;
        local70 = local70 * local64 >> 12;
        const local81 = q - local70;
        const local85 = p + local70;
        if (hPrime === 0) {
            this.green = local85;
            this.red = q;
            this.blue = p;
        }
        else if (hPrime === 1) {
            this.green = q;
            this.red = local81;
            this.blue = p;
        }
        else if (hPrime === 2) {
            this.red = p;
            this.green = q;
            this.blue = local85;
        }
        else if (hPrime === 3) {
            this.red = p;
            this.green = local81;
            this.blue = q;
        }
        else if (hPrime === 4) {
            this.red = local85;
            this.green = p;
            this.blue = q;
        }
        else if (hPrime === 5) {
            this.green = p;
            this.red = q;
            this.blue = local81;
        }
    }
    decode(buffer, code) {
        if (code === 0) {
            this.hueDelta = buffer.readShort();
        }
        else if (code === 1) {
            this.saturationDelta = ((buffer.readByte() << 12) / 100 | 0);
        }
        else if (code === 2) {
            this.lightnessDelta = ((buffer.readByte() << 12) / 100 | 0);
        }
    }
    /*private*/ rgbToHsl(r, g, b) {
        let xMax = r > g ? r : g;
        xMax = b > xMax ? b : xMax;
        let xMin = r < g ? r : g;
        xMin = b < xMin ? b : xMin;
        this.lightness = ((xMax + xMin) / 2 | 0);
        const chroma = xMax - xMin;
        if (chroma <= 0) {
            this.hue = 0;
        }
        else {
            const tempB = ((xMax - b << 12) / chroma | 0);
            const tempR = ((xMax - r << 12) / chroma | 0);
            const tempG = ((xMax - g << 12) / chroma | 0);
            if (xMax === r) {
                this.hue = xMin === g ? tempB + 20480 : 4096 - tempG;
            }
            else if (xMax === g) {
                this.hue = xMin === b ? tempR + 4096 : 12288 - tempB;
            }
            else {
                this.hue = xMin === r ? tempG + 12288 : 20480 - tempR;
            }
            this.hue = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(this.hue / 6);
        }
        if (this.lightness > 0 && this.lightness < 4096) {
            this.saturation = ((chroma << 12) / (this.lightness <= 2048 ? this.lightness * 2 : 8192 - this.lightness * 2) | 0);
        }
        else {
            this.saturation = 0;
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcRed = src[0];
            const srcGreen = src[1];
            const destRed = dest[0];
            const srcBlue = src[2];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    this.rgbToHsl(srcRed[x], srcGreen[x], srcBlue[x]);
                    this.lightness += this.lightnessDelta;
                    this.saturation += this.saturationDelta;
                    if (this.saturation < 0) {
                        this.saturation = 0;
                    }
                    this.hue += this.hueDelta;
                    if (this.saturation > 4096) {
                        this.saturation = 4096;
                    }
                    while ((this.hue < 0)) {
                        {
                            this.hue += 4096;
                        }
                    }
                    ;
                    if (this.lightness < 0) {
                        this.lightness = 0;
                    }
                    if (this.lightness > 4096) {
                        this.lightness = 4096;
                    }
                    while ((this.hue > 4096)) {
                        {
                            this.hue -= 4096;
                        }
                    }
                    ;
                    this.hslToRgb(this.hue, this.saturation, this.lightness);
                    destRed[x] = this.red;
                    destGreen[x] = this.green;
                    destBlue[x] = this.blue;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpHslAdjust["__class"] = "TextureOpHslAdjust";
class TextureOpInterpolate extends TextureOp {
    constructor() {
        super(3, false);
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src0 = this.getChildMonochromeOutput(0, y);
            const src1 = this.getChildMonochromeOutput(1, y);
            const src2 = this.getChildMonochromeOutput(2, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    const alpha = src2[x];
                    if (alpha === 4096) {
                        dest[x] = src0[x];
                    }
                    else if (alpha === 0) {
                        dest[x] = src1[x];
                    }
                    else {
                        dest[x] = alpha * src0[x] + src1[x] * (4096 - alpha) >> 12;
                    }
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src2 = this.getChildMonochromeOutput(2, y);
            const src0 = this.getChildColorOutput(0, y);
            const src1 = this.getChildColorOutput(1, y);
            const destRed = dest[0];
            const destGreen = dest[1];
            const destBlue = dest[2];
            const src0Green = src0[1];
            const src0Red = src0[0];
            const src1Green = src1[1];
            const src1Red = src1[0];
            const src0Blue = src0[2];
            const src1Blue = src1[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const alpha = src2[x];
                    if (alpha === 4096) {
                        destRed[x] = src0Red[x];
                        destGreen[x] = src0Green[x];
                        destBlue[x] = src0Blue[x];
                    }
                    else if (alpha === 0) {
                        destRed[x] = src1Red[x];
                        destGreen[x] = src1Green[x];
                        destBlue[x] = src1Blue[x];
                    }
                    else {
                        const local141 = 4096 - alpha;
                        destRed[x] = src1Red[x] * local141 + src0Red[x] * alpha >> 12;
                        destGreen[x] = src1Green[x] * local141 + alpha * src0Green[x] >> 12;
                        destBlue[x] = src0Blue[x] * alpha + local141 * src1Blue[x] >> 12;
                    }
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpInterpolate["__class"] = "TextureOpInterpolate";
class TextureOpInvert extends TextureOp {
    constructor() {
        super(1, false);
    }
    decode(buffer, code) {
        if (code === 0) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    dest[x] = 4096 - src[x];
                }
                ;
            }
        }
        return dest;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcRed = src[0];
            const srcBlue = src[2];
            const destRed = dest[0];
            const srcGreen = src[1];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    destRed[x] = 4096 - srcRed[x];
                    destGreen[x] = 4096 - srcGreen[x];
                    destBlue[x] = 4096 - srcBlue[x];
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpInvert["__class"] = "TextureOpInvert";
class TextureOpIrregularBricks extends TextureOp {
    constructor() {
        super(0, true);
        if (this.anInt79 === undefined) {
            this.anInt79 = 0;
        }
        this.anInt72 = 409;
        this.anInt81 = 1024;
        this.anInt77 = 1024;
        this.anInt82 = 819;
        this.anInt76 = 0;
        this.anInt75 = 1024;
        this.anInt84 = 1024;
        this.seed = 0;
        this.anInt87 = 2048;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (!this.monochromeImageCache.invalid) {
            return dest;
        }
        let local23 = 0;
        const pixels = this.monochromeImageCache.get$();
        let local30 = 0;
        let local32 = 0;
        let local34 = 0;
        let local36 = 0;
        let local38 = true;
        let local40 = 0;
        let local42 = true;
        const local49 = this.anInt84 * Texture.width >> 12;
        let local51 = 0;
        const local58 = this.anInt72 * Texture.height >> 12;
        const local65 = Texture.width * this.anInt87 >> 12;
        const local72 = this.anInt82 * Texture.height >> 12;
        if (local72 <= 1) {
            return pixels[y];
        }
        this.anInt79 = (Texture.width / 8 | 0) * this.anInt81 >> 12;
        const local99 = (Texture.width / local49 | 0) + 1;
        const random = new Random(this.seed);
        let local110 = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([local99, 3]);
        let local114 = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
            return 0;
        }
        else {
            let array = [];
            for (let i = 0; i < dims[0]; i++) {
                array.push(allocate(dims.slice(1)));
            }
            return array;
        } }; return allocate(dims); })([local99, 3]);
        while ((true)) {
            {
                while ((true)) {
                    {
                        let local125 = local49 + RandomUtils.nextInt(random, local65 - local49);
                        let local135 = RandomUtils.nextInt(random, local72 - local58) + local58;
                        let local139 = local32 + local125;
                        if (local139 > Texture.width) {
                            local125 = Texture.width - local32;
                            local139 = Texture.width;
                        }
                        let local153;
                        if (local38) {
                            local153 = 0;
                        }
                        else {
                            let local157 = local36;
                            const local161 = local114[local36];
                            local153 = local161[2];
                            let local167 = 0;
                            let local171 = local23 + local139;
                            if (local171 < 0) {
                                local171 += Texture.width;
                            }
                            if (Texture.width < local171) {
                                local171 -= Texture.width;
                            }
                            while ((true)) {
                                {
                                    const local196 = local114[local157];
                                    if (local196[0] <= local171 && local171 <= local196[1]) {
                                        if (local157 !== local36) {
                                            let local238 = local32 + local23;
                                            if (local238 < 0) {
                                                local238 += Texture.width;
                                            }
                                            if (local238 > Texture.width) {
                                                local238 -= Texture.width;
                                            }
                                            for (let local258 = 1; local258 <= local167; local258++) {
                                                {
                                                    const local269 = local114[(local258 + local36) % local40];
                                                    local153 = Math.max(local153, local269[2]);
                                                }
                                                ;
                                            }
                                            for (let local280 = 0; local280 <= local167; local280++) {
                                                {
                                                    const local295 = local114[(local280 + local36) % local40];
                                                    const local299 = local295[2];
                                                    if (local299 !== local153) {
                                                        const local306 = local295[1];
                                                        const local310 = local295[0];
                                                        let local320;
                                                        let local322;
                                                        if (local238 < local171) {
                                                            local320 = Math.max(local238, local310);
                                                            local322 = Math.min(local171, local306);
                                                        }
                                                        else if (local310 === 0) {
                                                            local322 = Math.min(local171, local306);
                                                            local320 = 0;
                                                        }
                                                        else {
                                                            local320 = Math.max(local238, local310);
                                                            local322 = Texture.width;
                                                        }
                                                        this.method69(local153 - local299, local322 - local320, local34 + local320, local299, random, pixels);
                                                    }
                                                }
                                                ;
                                            }
                                        }
                                        local36 = local157;
                                        break;
                                    }
                                    local157++;
                                    if (local157 >= local40) {
                                        local157 = 0;
                                    }
                                    local167++;
                                }
                            }
                            ;
                        }
                        if (Texture.height < local135 + local153) {
                            local135 = Texture.height - local153;
                        }
                        else {
                            local42 = false;
                        }
                        if (local139 === Texture.width) {
                            this.method69(local135, local125, local32 + local30, local153, random, pixels);
                            if (local42) {
                                return dest;
                            }
                            local38 = false;
                            const local440 = local51 + 1;
                            const local442 = local110[local51];
                            local42 = true;
                            local442[1] = local139;
                            local34 = local30;
                            local40 = local440;
                            local442[0] = local32;
                            local442[2] = local135 + local153;
                            local30 = RandomUtils.nextInt(random, Texture.width);
                            const local469 = local114;
                            local36 = 0;
                            local23 = local30 - local34;
                            local114 = local110;
                            let local480 = local23;
                            local110 = local469;
                            if (local23 < 0) {
                                local480 = local23 + Texture.width;
                            }
                            local51 = 0;
                            if (Texture.width < local480) {
                                local480 -= Texture.width;
                            }
                            while ((true)) {
                                {
                                    const local506 = local114[local36];
                                    if (local480 >= local506[0] && local506[1] >= local480) {
                                        local32 = 0;
                                        break;
                                    }
                                    local36++;
                                    if (local40 <= local36) {
                                        local36 = 0;
                                    }
                                }
                            }
                            ;
                        }
                        else {
                            const local388 = local110[local51++];
                            local388[1] = local139;
                            local388[2] = local135 + local153;
                            local388[0] = local32;
                            this.method69(local135, local125, local30 + local32, local153, random, pixels);
                            local32 = local139;
                        }
                    }
                }
                ;
            }
        }
        ;
    }
    postDecode() {
    }
    /*private*/ method69(arg0, arg1, arg2, arg3, arg4, arg5) {
        const local20 = this.anInt77 > 0 ? 4096 - RandomUtils.nextInt(arg4, this.anInt77) : 4096;
        const local28 = this.anInt79 * this.anInt75 >> 12;
        const local44 = this.anInt79 - (local28 > 0 ? RandomUtils.nextInt(arg4, local28) : 0);
        if (Texture.width <= arg2) {
            arg2 -= Texture.width;
        }
        if (local44 > 0) {
            if (arg0 <= 0 || arg1 <= 0) {
                return;
            }
            const local67 = (arg1 / 2 | 0);
            const local71 = (arg0 / 2 | 0);
            const local82 = local67 >= local44 ? local44 : local67;
            const local93 = local44 > local71 ? local71 : local44;
            const local97 = arg2 + local82;
            const local104 = arg1 - local82 * 2;
            for (let local106 = 0; local106 < arg0; local106++) {
                {
                    const local116 = arg5[local106 + arg3];
                    if (local93 <= local106) {
                        const local260 = arg0 - local106 - 1;
                        if (local93 <= local260) {
                            for (let local403 = 0; local403 < local82; local403++) {
                                {
                                    local116[Texture.widthMask & arg2 + local403] = local116[Texture.widthMask & arg1 + arg2 - local403 - 1] = (local20 * local403 / local82 | 0);
                                }
                                ;
                            }
                            if (local97 + local104 <= Texture.width) {
                                ArrayUtils.fill$int_A$int$int$int(local116, local97, local104, local20);
                            }
                            else {
                                const local461 = Texture.width - local97;
                                ArrayUtils.fill$int_A$int$int$int(local116, local97, local461, local20);
                                ArrayUtils.fill$int_A$int$int$int(local116, 0, local104 - local461, local20);
                            }
                        }
                        else {
                            const local274 = (local260 * local20 / local93 | 0);
                            if (this.anInt76 === 0) {
                                for (let local327 = 0; local327 < local82; local327++) {
                                    {
                                        const local336 = (local327 * local20 / local82 | 0);
                                        local116[Texture.widthMask & arg2 + local327] = local116[arg1 + arg2 - local327 - 1 & Texture.widthMask] = local274 * local336 >> 12;
                                    }
                                    ;
                                }
                            }
                            else {
                                for (let local280 = 0; local280 < local82; local280++) {
                                    {
                                        const local289 = (local20 * local280 / local82 | 0);
                                        local116[Texture.widthMask & local280 + arg2] = local116[Texture.widthMask & arg2 + arg1 - local280 - 1] = local274 > local289 ? local289 : local274;
                                    }
                                    ;
                                }
                            }
                            if (Texture.width < local104 + local97) {
                                const local379 = Texture.width - local97;
                                ArrayUtils.fill$int_A$int$int$int(local116, local97, local379, local274);
                                ArrayUtils.fill$int_A$int$int$int(local116, 0, local104 - local379, local274);
                            }
                            else {
                                ArrayUtils.fill$int_A$int$int$int(local116, local97, local104, local274);
                            }
                        }
                    }
                    else {
                        const local130 = (local106 * local20 / local93 | 0);
                        if (this.anInt76 === 0) {
                            for (let local184 = 0; local184 < local82; local184++) {
                                {
                                    const local193 = (local20 * local184 / local82 | 0);
                                    local116[Texture.widthMask & local184 + arg2] = local116[arg2 + arg1 - local184 - 1 & Texture.widthMask] = local193 * local130 >> 12;
                                }
                                ;
                            }
                        }
                        else {
                            for (let local138 = 0; local138 < local82; local138++) {
                                {
                                    const local151 = (local20 * local138 / local82 | 0);
                                    local116[local138 + arg2 & Texture.widthMask] = local116[arg1 + arg2 - local138 - 1 & Texture.widthMask] = local130 <= local151 ? local130 : local151;
                                }
                                ;
                            }
                        }
                        if (local97 + local104 > Texture.width) {
                            const local231 = Texture.width - local97;
                            ArrayUtils.fill$int_A$int$int$int(local116, local97, local231, local130);
                            ArrayUtils.fill$int_A$int$int$int(local116, 0, local104 - local231, local130);
                        }
                        else {
                            ArrayUtils.fill$int_A$int$int$int(local116, local97, local104, local130);
                        }
                    }
                }
                ;
            }
        }
        else if (Texture.width >= arg1 + arg2) {
            for (let local486 = 0; local486 < arg0; local486++) {
                {
                    ArrayUtils.fill$int_A$int$int$int(arg5[local486 + arg3], arg2, arg1, local20);
                }
                ;
            }
        }
        else {
            const local507 = Texture.width - arg2;
            for (let local509 = 0; local509 < arg0; local509++) {
                {
                    const local518 = arg5[local509 + arg3];
                    ArrayUtils.fill$int_A$int$int$int(local518, arg2, local507, local20);
                    ArrayUtils.fill$int_A$int$int$int(local518, 0, arg1 - local507, local20);
                }
                ;
            }
        }
    }
    decode(buffer, code) {
        if (code === 0) {
            this.seed = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.anInt84 = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.anInt87 = buffer.readUnsignedShort();
        }
        else if (code === 3) {
            this.anInt72 = buffer.readUnsignedShort();
        }
        else if (code === 4) {
            this.anInt82 = buffer.readUnsignedShort();
        }
        else if (code === 5) {
            this.anInt81 = buffer.readUnsignedShort();
        }
        else if (code === 6) {
            this.anInt76 = buffer.readUnsignedByte();
        }
        else if (code === 7) {
            this.anInt75 = buffer.readUnsignedShort();
        }
        else if (code === 8) {
            this.anInt77 = buffer.readUnsignedShort();
        }
    }
}
TextureOpIrregularBricks["__class"] = "TextureOpIrregularBricks";
class TextureOpKaleidoscope extends TextureOp {
    constructor() {
        super(1, false);
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const destRed = dest[0];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    this.method4301(x, y);
                    const src = this.getChildColorOutput(0, TextureOpKaleidoscope.y0);
                    destRed[x] = src[0][TextureOpKaleidoscope.x0];
                    destGreen[x] = src[1][TextureOpKaleidoscope.x0];
                    destBlue[x] = src[2][TextureOpKaleidoscope.x0];
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    /*private*/ method4301(x, y) {
        const normalisedX = Texture.normalisedX[x];
        const normalisedY = Texture.normalisedY[y];
        const angle = Math.fround(Math.atan2(normalisedX - 2048, normalisedY - 2048));
        if (angle >= -3.141592653589793 && angle <= -2.356194490192345) {
            TextureOpKaleidoscope.x0 = x;
            TextureOpKaleidoscope.y0 = y;
        }
        else if (angle <= -1.5707963267948966 && angle >= -2.356194490192345) {
            TextureOpKaleidoscope.y0 = x;
            TextureOpKaleidoscope.x0 = y;
        }
        else if (angle <= -0.7853981633974483 && angle >= -1.5707963267948966) {
            TextureOpKaleidoscope.x0 = Texture.width - y;
            TextureOpKaleidoscope.y0 = x;
        }
        else if (angle <= 0.0 && angle >= -0.7853981633974483) {
            TextureOpKaleidoscope.y0 = Texture.height - y;
            TextureOpKaleidoscope.x0 = x;
        }
        else if (angle >= 0.0 && angle <= 0.7853981633974483) {
            TextureOpKaleidoscope.x0 = Texture.width - x;
            TextureOpKaleidoscope.y0 = Texture.height - y;
        }
        else if (angle >= 0.7853981633974483 && angle <= 1.5707963267948966) {
            TextureOpKaleidoscope.x0 = Texture.width - y;
            TextureOpKaleidoscope.y0 = Texture.height - x;
        }
        else if (angle >= 1.5707963267948966 && angle <= 2.356194490192345) {
            TextureOpKaleidoscope.x0 = y;
            TextureOpKaleidoscope.y0 = Texture.height - x;
        }
        else if (angle >= 2.356194490192345 && angle <= 3.141592653589793) {
            TextureOpKaleidoscope.y0 = y;
            TextureOpKaleidoscope.x0 = Texture.width - x;
        }
        TextureOpKaleidoscope.x0 &= Texture.widthMask;
        TextureOpKaleidoscope.y0 &= Texture.heightMask;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            for (let x = 0; x < Texture.width; x++) {
                {
                    this.method4301(x, y);
                    const src = this.getChildMonochromeOutput(0, TextureOpKaleidoscope.y0);
                    dest[x] = src[TextureOpKaleidoscope.x0];
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpKaleidoscope.y0 = 0;
TextureOpKaleidoscope.x0 = 0;
TextureOpKaleidoscope["__class"] = "TextureOpKaleidoscope";
class TextureOpLineNoise extends TextureOp {
    constructor() {
        super(0, true);
        this.seed = 0;
        this.minAngle = 0;
        this.count = 2000;
        this.maxAngle = 4096;
        this.length = 16;
    }
    postDecode() {
        TextureOp.createTrigonometryTables();
    }
    decode(buffer, code) {
        if (code === 0) {
            this.seed = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.count = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.length = buffer.readUnsignedByte();
        }
        else if (code === 3) {
            this.minAngle = buffer.readUnsignedShort();
        }
        else if (code === 4) {
            this.maxAngle = buffer.readUnsignedShort();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local16 = this.maxAngle >> 1;
            const pixels = this.monochromeImageCache.get$();
            const random = new Random(this.seed);
            for (let i = 0; i < this.count; i++) {
                {
                    let angle = this.maxAngle > 0 ? this.minAngle + RandomUtils.nextInt(random, this.maxAngle) - local16 : this.minAngle;
                    angle = angle >> 4 & 255;
                    let x0 = RandomUtils.nextInt(random, Texture.width);
                    let y0 = RandomUtils.nextInt(random, Texture.height);
                    let x1 = x0 + (TextureOp.COSINE[angle] * this.length >> 12);
                    let y1 = y0 + (TextureOp.SINE[angle] * this.length >> 12);
                    let local105 = y1 - y0;
                    let local110 = x1 - x0;
                    if (local110 !== 0 || local105 !== 0) {
                        if (local105 < 0) {
                            local105 = -local105;
                        }
                        if (local110 < 0) {
                            local110 = -local110;
                        }
                        const local145 = local105 > local110;
                        if (local145) {
                            const local150 = x1;
                            const local152 = x0;
                            x0 = y0;
                            x1 = y1;
                            y0 = local152;
                            y1 = local150;
                        }
                        if (x0 > x1) {
                            const local165 = x0;
                            x0 = x1;
                            const local169 = y0;
                            x1 = local165;
                            y0 = y1;
                            y1 = local169;
                        }
                        let local177 = y0;
                        const local181 = x1 - x0;
                        let local186 = (-local181 / 2 | 0);
                        let local191 = y1 - y0;
                        const local201 = 1024 - (RandomUtils.nextInt(random, 4096) >> 2);
                        if (local191 < 0) {
                            local191 = -local191;
                        }
                        const local213 = (2048 / local181 | 0);
                        const local224 = y1 <= y0 ? -1 : 1;
                        for (let local226 = x0; local226 < x1; local226++) {
                            {
                                local186 += local191;
                                const local247 = local201 + (local226 - x0) * local213 + 1024;
                                const local251 = local177 & Texture.heightMask;
                                const local255 = Texture.widthMask & local226;
                                if (local186 > 0) {
                                    local186 += -local181;
                                    local177 += local224;
                                }
                                if (local145) {
                                    pixels[local251][local255] = local247;
                                }
                                else {
                                    pixels[local255][local251] = local247;
                                }
                            }
                            ;
                        }
                    }
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpLineNoise["__class"] = "TextureOpLineNoise";
class TextureOpMandelbrot extends TextureOp {
    constructor() {
        super(0, true);
        this.anInt1159 = 20;
        this.anInt1157 = 0;
        this.anInt1160 = 1365;
        this.anInt1164 = 0;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.anInt1160 = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.anInt1159 = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.anInt1164 = buffer.readUnsignedShort();
        }
        else if (code === 3) {
            this.anInt1157 = buffer.readUnsignedShort();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            for (let x = 0; x < Texture.width; x++) {
                {
                    const local42 = this.anInt1164 + ((Texture.normalisedX[x] << 12) / this.anInt1160 | 0);
                    const local54 = this.anInt1157 + ((Texture.normalisedY[y] << 12) / this.anInt1160 | 0);
                    let local58 = local54;
                    let local60 = local42;
                    let local64 = 0;
                    let local70 = local42 * local42 >> 12;
                    let local76 = local54 * local54 >> 12;
                    while ((local70 + local76 < 16384 && local64 < this.anInt1159)) {
                        {
                            local64++;
                            local58 = local54 + (local58 * local60 >> 12) * 2;
                            local60 = local42 + local70 - local76;
                            local76 = local58 * local58 >> 12;
                            local70 = local60 * local60 >> 12;
                        }
                    }
                    ;
                    dest[x] = local64 >= this.anInt1159 - 1 ? 0 : ((local64 << 12) / this.anInt1159 | 0);
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpMandelbrot["__class"] = "TextureOpMandelbrot";
class TextureOpMonochrome extends TextureOp {
    constructor() {
        super(1, true);
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcBlue = src[2];
            const srcGreen = src[1];
            const srcRed = src[0];
            for (let x = 0; x < Texture.width; x++) {
                {
                    dest[x] = ((srcGreen[x] + srcRed[x] + srcBlue[x]) / 3 | 0);
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpMonochrome["__class"] = "TextureOpMonochrome";
class TextureOpMonochromeEdgeDetector extends TextureOp {
    constructor() {
        super(1, true);
        this.anInt4832 = 4096;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src0 = this.getChildMonochromeOutput(0, y - 1 & Texture.heightMask);
            const src1 = this.getChildMonochromeOutput(0, y);
            const src2 = this.getChildMonochromeOutput(0, y + 1 & Texture.heightMask);
            for (let x = 0; x < Texture.width; x++) {
                {
                    const dy = this.anInt4832 * (src2[x] - src0[x]);
                    const dx = this.anInt4832 * (src1[Texture.widthMask & x + 1] - src1[Texture.widthMask & x - 1]);
                    const dx0 = dx >> 12;
                    const dy0 = dy >> 12;
                    const dySquared = dy0 * dy0 >> 12;
                    const dxSquared = dx0 * dx0 >> 12;
                    const local117 = ((Math.sqrt(Math.fround((dySquared + dxSquared + 4096) / 4096.0)) * 4096.0) | 0);
                    const local128 = local117 === 0 ? 0 : (16777216 / local117 | 0);
                    dest[x] = 4096 - local128;
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.anInt4832 = buffer.readUnsignedShort();
        }
    }
}
TextureOpMonochromeEdgeDetector["__class"] = "TextureOpMonochromeEdgeDetector";
class TextureOpMonochromeFill extends TextureOp {
    constructor(value) {
        if (((typeof value === 'number') || value === null)) {
            let __args = arguments;
            super(0, true);
            if (this.value === undefined) {
                this.value = 0;
            }
            this.value = 4096;
            this.value = value;
        }
        else if (value === undefined) {
            let __args = arguments;
            {
                let __args = arguments;
                let value = 4096;
                super(0, true);
                if (this.value === undefined) {
                    this.value = 0;
                }
                this.value = 4096;
                this.value = value;
            }
            if (this.value === undefined) {
                this.value = 0;
            }
        }
        else
            throw new Error('invalid overload');
    }
    decode(buffer, code) {
        if (code === 0) {
            this.value = ((buffer.readUnsignedByte() << 12) / 255 | 0);
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            ArrayUtils.fill$int_A$int$int$int(dest, 0, Texture.width, this.value);
        }
        return dest;
    }
}
TextureOpMonochromeFill["__class"] = "TextureOpMonochromeFill";
class TextureOpNoise extends TextureOp {
    constructor() {
        super(0, true);
    }
    /*private*/ noise(x, y) {
        let noise = x + y * 57;
        noise ^= noise << 1;
        return 4096 - (((noise * (noise * 15731 * noise + 789221 | 0) + 1376312589 & 2147483647) / 262144 | 0) | 0) | 0;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const heightFraction = Texture.normalisedY[y];
            for (let x = 0; x < Texture.width; x++) {
                {
                    dest[x] = this.noise(Texture.normalisedX[x], heightFraction) % 4096;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpNoise["__class"] = "TextureOpNoise";
class TextureOpPerlinNoise extends TextureOp {
    constructor() {
        super(0, true);
        if (this.aShortArray37 === undefined) {
            this.aShortArray37 = null;
        }
        if (this.aShortArray38 === undefined) {
            this.aShortArray38 = null;
        }
        this.permutation = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(512);
        this.aBoolean181 = true;
        this.anInt2620 = 1638;
        this.anInt2625 = 4;
        this.anInt2628 = 4;
        this.seed = 0;
        this.anInt2631 = 4;
    }
    /*private*/ method2049() {
        if (this.anInt2620 > 0) {
            this.aShortArray38 = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(this.anInt2628);
            this.aShortArray37 = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(this.anInt2628);
            for (let local64 = 0; local64 < this.anInt2628; local64++) {
                {
                    this.aShortArray37[local64] = ((Math.pow(Math.fround(this.anInt2620 / 4096.0), local64) * 4096.0) | 0);
                    this.aShortArray38[local64] = (Math.pow(2.0, local64) | 0);
                }
                ;
            }
        }
        else if (this.aShortArray37 != null && this.aShortArray37.length === this.anInt2628) {
            this.aShortArray38 = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })(this.anInt2628);
            for (let local29 = 0; local29 < this.anInt2628; local29++) {
                {
                    this.aShortArray38[local29] = (Math.pow(2.0, local29) | 0);
                }
                ;
            }
        }
    }
    decode(buffer, code) {
        if (code === 0) {
            this.aBoolean181 = buffer.readUnsignedByte() === 1;
        }
        else if (code === 1) {
            this.anInt2628 = buffer.readUnsignedByte();
        }
        else if (code === 2) {
            this.anInt2620 = buffer.readShort();
            if (this.anInt2620 < 0) {
                this.aShortArray37 = (s => { let a = []; while (s-- > 0)
                    a.push(0); return a; })(this.anInt2628);
                for (let local81 = 0; local81 < this.anInt2628; local81++) {
                    {
                        this.aShortArray37[local81] = (buffer.readShort() | 0);
                    }
                    ;
                }
            }
        }
        else if (code === 3) {
            this.anInt2631 = this.anInt2625 = buffer.readUnsignedByte();
        }
        else if (code === 4) {
            this.seed = buffer.readUnsignedByte();
        }
        else if (code === 5) {
            this.anInt2631 = buffer.readUnsignedByte();
        }
        else if (code === 6) {
            this.anInt2625 = buffer.readUnsignedByte();
        }
    }
    /*private*/ method2051(arg0, arg1, arg2, arg3, arg4, arg5) {
        const local5 = arg5 - 4096;
        let local13 = arg0 >> 12;
        arg0 &= 4095;
        let local21 = local13 + 1;
        local13 &= 255;
        if (local21 >= arg4) {
            local21 = 0;
        }
        const local35 = arg0 - 4096;
        const local39 = local21 & 255;
        const local48 = this.permutation[arg3 + local13] & 3;
        let local65;
        if (local48 <= 1) {
            local65 = local48 === 0 ? arg5 + arg0 : arg5 - arg0;
        }
        else {
            local65 = local48 === 2 ? arg0 - arg5 : -arg5 - arg0;
        }
        const local92 = this.permutation[arg3 + local39] & 3;
        const local96 = MonochromeImageCache.PERLIN_FADE_$LI$()[arg0];
        let local115;
        if (local92 > 1) {
            local115 = local92 === 2 ? local35 - arg5 : -local35 - arg5;
        }
        else {
            local115 = local92 === 0 ? arg5 + local35 : arg5 - local35;
        }
        const local138 = this.permutation[local13 + arg1] & 3;
        const local150 = local65 + (local96 * (local115 - local65) >> 12);
        let local166;
        if (local138 > 1) {
            local166 = local138 === 2 ? arg0 - local5 : -arg0 - local5;
        }
        else {
            local166 = local138 === 0 ? local5 + arg0 : local5 - arg0;
        }
        const local189 = this.permutation[arg1 + local39] & 3;
        let local206;
        if (local189 <= 1) {
            local206 = local189 === 0 ? local5 + local35 : local5 - local35;
        }
        else {
            local206 = local189 === 2 ? local35 - local5 : -local5 - local35;
        }
        const local234 = local166 + ((local206 - local166) * local96 >> 12);
        return local150 + ((local234 - local150) * arg2 >> 12);
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            this.method2053(dest, y);
        }
        return dest;
    }
    method2053(dest, y) {
        const local20 = this.anInt2625 * Texture.normalisedY[y];
        if (this.anInt2628 === 1) {
            const local31 = this.aShortArray37[0];
            const local38 = this.aShortArray38[0] << 12;
            const local45 = local38 * this.anInt2631 >> 12;
            const local52 = this.anInt2625 * local38 >> 12;
            let local58 = local38 * local20 >> 12;
            const local62 = local58 >> 12;
            local58 &= 4095;
            const local75 = this.permutation[local62 & 255] & 255;
            const local79 = MonochromeImageCache.PERLIN_FADE_$LI$()[local58];
            let local83 = local62 + 1;
            if (local52 <= local83) {
                local83 = 0;
            }
            const local101 = this.permutation[local83 & 255] & 255;
            if (this.aBoolean181) {
                for (let local147 = 0; local147 < Texture.width; local147++) {
                    {
                        const local157 = Texture.normalisedX[local147] * this.anInt2631;
                        let local171 = this.method2051(local38 * local157 >> 12, local101, local79, local75, local45, local58);
                        local171 = local171 * local31 >> 12;
                        dest[local147] = (local171 >> 1) + 2048;
                    }
                    ;
                }
            }
            else {
                for (let local106 = 0; local106 < Texture.width; local106++) {
                    {
                        const local120 = Texture.normalisedX[local106] * this.anInt2631;
                        const local134 = this.method2051(local38 * local120 >> 12, local101, local79, local75, local45, local58);
                        dest[local106] = local31 * local134 >> 12;
                    }
                    ;
                }
            }
            return;
        }
        const local194 = this.aShortArray37[0];
        if (local194 > 8 || local194 < -8) {
            const local211 = this.aShortArray38[0] << 12;
            let local217 = local211 * local20 >> 12;
            const local221 = local217 >> 12;
            const local228 = this.anInt2631 * local211 >> 12;
            const local235 = local211 * this.anInt2625 >> 12;
            local217 &= 4095;
            const local248 = this.permutation[local221 & 255] & 255;
            const local252 = MonochromeImageCache.PERLIN_FADE_$LI$()[local217];
            let local256 = local221 + 1;
            if (local256 >= local235) {
                local256 = 0;
            }
            const local275 = this.permutation[local256 & 255] & 255;
            for (let local277 = 0; local277 < Texture.width; local277++) {
                {
                    const local287 = this.anInt2631 * Texture.normalisedX[local277];
                    const local301 = this.method2051(local211 * local287 >> 12, local275, local252, local248, local228, local217);
                    dest[local277] = local194 * local301 >> 12;
                }
                ;
            }
        }
        for (let local314 = 1; local314 < this.anInt2628; local314++) {
            {
                const local323 = this.aShortArray37[local314];
                if (local323 > 8 || local323 < -8) {
                    const local336 = this.aShortArray38[local314] << 12;
                    const local343 = local336 * this.anInt2631 >> 12;
                    let local349 = local20 * local336 >> 12;
                    const local356 = this.anInt2625 * local336 >> 12;
                    const local360 = local349 >> 12;
                    let local364 = local360 + 1;
                    local349 &= 4095;
                    const local377 = this.permutation[local360 & 255] & 255;
                    if (local364 >= local356) {
                        local364 = 0;
                    }
                    const local392 = this.permutation[local364 & 255] & 255;
                    const local396 = MonochromeImageCache.PERLIN_FADE_$LI$()[local349];
                    if (this.aBoolean181 && local314 === this.anInt2628 - 1) {
                        for (let local447 = 0; local447 < Texture.width; local447++) {
                            {
                                const local461 = Texture.normalisedX[local447] * this.anInt2631;
                                let local475 = this.method2051(local461 * local336 >> 12, local392, local396, local377, local343, local349);
                                local475 = dest[local447] + (local323 * local475 >> 12);
                                dest[local447] = (local475 >> 1) + 2048;
                            }
                            ;
                        }
                    }
                    else {
                        for (let local407 = 0; local407 < Texture.width; local407++) {
                            {
                                const local417 = Texture.normalisedX[local407] * this.anInt2631;
                                const local431 = this.method2051(local336 * local417 >> 12, local392, local396, local377, local343, local349);
                                dest[local407] += local323 * local431 >> 12;
                            }
                            ;
                        }
                    }
                }
            }
            ;
        }
    }
    postDecode() {
        this.permutation = TextureOp.getPermutation(this.seed);
        this.method2049();
        for (let local19 = this.anInt2628 - 1; local19 >= 1; local19--) {
            {
                const local35 = this.aShortArray37[local19];
                if (local35 > 8 || local35 < -8) {
                    break;
                }
                this.anInt2628--;
            }
            ;
        }
    }
}
TextureOpPerlinNoise["__class"] = "TextureOpPerlinNoise";
class TextureOpPolarDistortion extends TextureOp {
    constructor() {
        super(3, false);
        this.magnitude = 32768;
    }
    postDecode() {
        TextureOp.createTrigonometryTables();
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src1 = this.getChildMonochromeOutput(1, y);
            const src2 = this.getChildMonochromeOutput(2, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    const angle = src1[x] >> 4 & 255;
                    const magnitude = this.magnitude * src2[x] >> 12;
                    const y0 = magnitude * TextureOp.SINE[angle] >> 12;
                    const y1 = Texture.heightMask & y + (y0 >> 12);
                    const x0 = magnitude * TextureOp.COSINE[angle] >> 12;
                    const x1 = Texture.widthMask & x + (x0 >> 12);
                    const src0 = this.getChildMonochromeOutput(0, y1);
                    dest[x] = src0[x1];
                }
                ;
            }
        }
        return dest;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.magnitude = buffer.readUnsignedShort() << 4;
        }
        else if (code === 1) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src1 = this.getChildMonochromeOutput(1, y);
            const src2 = this.getChildMonochromeOutput(2, y);
            const destRed = dest[0];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const magnitude = (src2[x] * this.magnitude) >> 12;
                    const angle = ((src1[x] * 255) >> 12) & 255;
                    const y0 = (magnitude * TextureOp.SINE[angle]) >> 12;
                    const x0 = (magnitude * TextureOp.COSINE[angle]) >> 12;
                    const x1 = ((x0 >> 12) + x) & Texture.widthMask;
                    const y1 = ((y0 >> 12) + y) & Texture.heightMask;
                    const src0 = this.getChildColorOutput(0, y1);
                    destRed[x] = src0[0][x1];
                    destGreen[x] = src0[1][x1];
                    destBlue[x] = src0[2][x1];
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpPolarDistortion["__class"] = "TextureOpPolarDistortion";
class TextureOpRange extends TextureOp {
    constructor() {
        super(1, false);
        this.range = 2048;
        this.minValue = 1024;
        this.maxValue = 3072;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const src = this.getChildMonochromeOutput(0, y);
            for (let x = 0; x < Texture.width; x++) {
                {
                    dest[x] = this.minValue + (src[x] * this.range >> 12);
                }
                ;
            }
        }
        return dest;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const src = this.getChildColorOutput(0, y);
            const srcRed = src[0];
            const srcGreen = src[1];
            const destRed = dest[0];
            const destBlue = dest[2];
            const destGreen = dest[1];
            const srcBlue = src[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    destRed[x] = this.minValue + (this.range * srcRed[x] >> 12);
                    destGreen[x] = this.minValue + (this.range * srcGreen[x] >> 12);
                    destBlue[x] = this.minValue + (this.range * srcBlue[x] >> 12);
                }
                ;
            }
        }
        return dest;
    }
    postDecode() {
        this.range = this.maxValue - this.minValue;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.minValue = buffer.readUnsignedShort();
        }
        else if (code === 1) {
            this.maxValue = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
}
TextureOpRange["__class"] = "TextureOpRange";
class TextureOpRasterizer extends TextureOp {
    constructor() {
        super(0, true);
        if (this.ops === undefined) {
            this.ops = null;
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            this.render(this.monochromeImageCache.get$());
        }
        return dest;
    }
    getColorOutput(y) {
        const entry = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const width = Texture.width;
            const height = Texture.height;
            const src = (function (dims) { let allocate = function (dims) { if (dims.length === 0) {
                return 0;
            }
            else {
                let array = [];
                for (let i = 0; i < dims[0]; i++) {
                    array.push(allocate(dims.slice(1)));
                }
                return array;
            } }; return allocate(dims); })([height, width]);
            const dest = this.colorImageCache.get$();
            this.render(src);
            for (let y0 = 0; y0 < Texture.height; y0++) {
                {
                    const destRow = dest[y0];
                    const destGreen = destRow[1];
                    const destBlue = destRow[2];
                    const srcRow = src[y0];
                    const destRed = destRow[0];
                    for (let x = 0; x < Texture.width; x++) {
                        {
                            const rgb = srcRow[x];
                            destBlue[x] = (rgb & 255) << 4;
                            destGreen[x] = rgb >> 4 & 4080;
                            destRed[x] = rgb >> 12 & 4080;
                        }
                        ;
                    }
                }
                ;
            }
        }
        return entry;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.ops = (s => { let a = []; while (s-- > 0)
                a.push(null); return a; })(buffer.readUnsignedByte());
            for (let i = 0; i < this.ops.length; i++) {
                {
                    const op = buffer.readUnsignedByte();
                    if (op === 0) {
                        this.ops[i] = TextureOpRasterizerLine.create(buffer);
                    }
                    else if (op === 1) {
                        this.ops[i] = TextureOpRasterizerBezierCurve.create(buffer);
                    }
                    else if (op === 2) {
                        this.ops[i] = TextureOpRasterizerRectangle.create(buffer);
                    }
                    else if (op === 3) {
                        this.ops[i] = TextureOpRasterizerEllipse.create(buffer);
                    }
                }
                ;
            }
        }
        else if (code === 1) {
            this.monochrome = buffer.readUnsignedByte() === 1;
        }
    }
    /*private*/ render(pixels) {
        const width = Texture.width;
        const height = Texture.height;
        MergedStatics.sub35_method4335(pixels);
        MergedStatics.sub18_method4374(Texture.heightMask, Texture.widthMask);
        if (this.ops == null) {
            return;
        }
        for (let i = 0; i < this.ops.length; i++) {
            {
                const op = this.ops[i];
                const outlineColor = op.outlineColor;
                const fillColor = op.fillColor;
                if (fillColor >= 0) {
                    if (outlineColor >= 0) {
                        op.render(width, height);
                    }
                    else {
                        op.renderFill(width, height);
                    }
                }
                else if (outlineColor >= 0) {
                    op.renderOutline(width, height);
                }
            }
            ;
        }
    }
}
TextureOpRasterizer["__class"] = "TextureOpRasterizer";
class TextureOpSprite extends TextureOp {
    constructor() {
        super(0, false);
        if (this.height === undefined) {
            this.height = 0;
        }
        if (this.width === undefined) {
            this.width = 0;
        }
        if (this.pixels === undefined) {
            this.pixels = null;
        }
        this.spriteId = -1;
    }
    loadSprite() {
        if (this.pixels != null) {
            return true;
        }
        else if (this.spriteId >= 0) {
            const img = Texture.loadedTextures.getSprite(this.spriteId);
            this.width = img.width;
            this.height = img.height;
            this.pixels = img.data;
            return true;
        }
        else {
            return false;
        }
    }
    decode(buffer, code) {
        if (code === 0) {
            this.spriteId = buffer.readUnsignedShort();
        }
    }
    clearImageCache() {
        super.clearImageCache();
        this.pixels = null;
    }
    getSpriteId() {
        return this.spriteId;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid && this.loadSprite()) {
            const destRed = dest[0];
            const destGreen = dest[1];
            const destBlue = dest[2];
            let index = (Texture.height === this.height ? y : (y * this.height / Texture.height | 0)) * this.width;
            if (this.width === Texture.width) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        destRed[x] = this.pixels[index++];
                        destGreen[x] = this.pixels[index++];
                        destBlue[x] = this.pixels[index++];
                        index++;
                    }
                    ;
                }
            }
            else {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const srcX = (this.width * x / Texture.width | 0);
                        destRed[x] = this.pixels[(index + srcX) * 4 + 0] << 4;
                        destGreen[x] = this.pixels[(index + srcX) * 4 + 1] << 4;
                        destBlue[x] = this.pixels[(index + srcX) * 4 + 2] << 4;
                    }
                    ;
                }
            }
        }
        return dest;
    }
}
TextureOpSprite["__class"] = "TextureOpSprite";
class TextureOpSquareWaveform extends TextureOp {
    constructor() {
        super(0, true);
        if (this.anIntArray498 === undefined) {
            this.anIntArray498 = null;
        }
        if (this.anIntArray499 === undefined) {
            this.anIntArray499 = null;
        }
        this.frequency = 10;
        this.ratio = 2048;
        this.mode = 0;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.frequency = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.ratio = buffer.readUnsignedShort();
        }
        else if (code === 2) {
            this.mode = buffer.readUnsignedByte();
        }
    }
    postDecode() {
        this.method3784();
    }
    /*private*/ method3784() {
        this.anIntArray498 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(this.frequency + 1);
        const local17 = (4096 / this.frequency | 0);
        this.anIntArray499 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(this.frequency + 1);
        const local31 = local17 * this.ratio >> 12;
        let local33 = 0;
        for (let local35 = 0; local35 < this.frequency; local35++) {
            {
                this.anIntArray498[local35] = local33;
                this.anIntArray499[local35] = local31 + local33;
                local33 += local17;
            }
            ;
        }
        this.anIntArray498[this.frequency] = 4096;
        this.anIntArray499[this.frequency] = this.anIntArray499[0] + 4096;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local26 = Texture.normalisedY[y];
            if (this.mode === 0) {
                let local140 = 0;
                for (let local142 = 0; local142 < this.frequency; local142++) {
                    {
                        if (local26 >= this.anIntArray498[local142] && local26 < this.anIntArray498[local142 + 1]) {
                            if (local26 < this.anIntArray499[local142]) {
                                local140 = 4096;
                            }
                            break;
                        }
                    }
                    ;
                }
                ArrayUtils.fill$int_A$int$int$int(dest, 0, Texture.width, local140);
            }
            else {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        let local40 = 0;
                        let local42 = 0;
                        const normalisedX = Texture.normalisedX[x];
                        const local49 = this.mode;
                        if (local49 === 1) {
                            local40 = normalisedX;
                        }
                        else if (local49 === 2) {
                            local40 = (local26 + normalisedX - 4096 >> 1) + 2048;
                        }
                        else if (local49 === 3) {
                            local40 = (normalisedX - local26 >> 1) + 2048;
                        }
                        for (let local86 = 0; local86 < this.frequency; local86++) {
                            {
                                if (this.anIntArray498[local86] <= local40 && local40 < this.anIntArray498[local86 + 1]) {
                                    if (local40 < this.anIntArray499[local86]) {
                                        local42 = 4096;
                                    }
                                    break;
                                }
                            }
                            ;
                        }
                        dest[x] = local42;
                    }
                    ;
                }
            }
        }
        return dest;
    }
}
TextureOpSquareWaveform["__class"] = "TextureOpSquareWaveform";
class TextureOpTexture extends TextureOp {
    constructor() {
        super(0, false);
        if (this.width === undefined) {
            this.width = 0;
        }
        if (this.height === undefined) {
            this.height = 0;
        }
        if (this.pixels === undefined) {
            this.pixels = null;
        }
        this.textureId = -1;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid && this.loadTexture()) {
            let index = this.width * (Texture.height === this.height ? y : (y * this.height / Texture.height | 0));
            const destRed = dest[0];
            const destBlue = dest[2];
            const destGreen = dest[1];
            if (this.width === Texture.width) {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const color = this.pixels[index++];
                        destBlue[x] = (color & 255) << 4;
                        destGreen[x] = color >> 4 & 4080;
                        destRed[x] = color >> 12 & 4080;
                    }
                    ;
                }
            }
            else {
                for (let x = 0; x < Texture.width; x++) {
                    {
                        const srcX = (this.width * x / Texture.width | 0);
                        const color = this.pixels[srcX + index];
                        destBlue[x] = (color & 255) << 4;
                        destGreen[x] = color >> 4 & 4080;
                        destRed[x] = color >> 12 & 4080;
                    }
                    ;
                }
            }
        }
        return dest;
    }
    /*private*/ loadTexture() {
        if (this.pixels != null) {
            return true;
        }
        else if (this.textureId >= 0) {
            const img = Texture.loadedTextures.getTexture(this.textureId);
            this.width = img.width;
            this.height = img.height;
            this.pixels = (s => { let a = []; while (s-- > 0)
                a.push(0); return a; })((img.data.length | 0));
            const data = img.data;
            for (let i = 0; i < img.data.length / 4; i++) {
                {
                    this.pixels[i] = (data[i * 4 + 0] << 16) | (data[i * 4 + 1] << 8) | (data[i * 4 + 2]);
                }
                ;
            }
            return true;
        }
        else {
            return false;
        }
    }
    decode(buffer, code) {
        if (code === 0) {
            this.textureId = buffer.readUnsignedShort();
        }
    }
    clearImageCache() {
        super.clearImageCache();
        this.pixels = null;
    }
    getTextureId() {
        return this.textureId;
    }
}
TextureOpTexture["__class"] = "TextureOpTexture";
class TextureOpTile extends TextureOp {
    constructor() {
        super(1, false);
        this.horizontalTiles = 4;
        this.verticalTiles = 4;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.horizontalTiles = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.verticalTiles = buffer.readUnsignedByte();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const tileWidth = (Texture.width / this.horizontalTiles | 0);
            const tileHeight = (Texture.height / this.verticalTiles | 0);
            let src;
            if (tileHeight > 0) {
                const srcY = y % tileHeight;
                src = this.getChildMonochromeOutput(0, (Texture.height * srcY / tileHeight | 0));
            }
            else {
                src = this.getChildMonochromeOutput(0, 0);
            }
            for (let x = 0; x < Texture.width; x++) {
                {
                    if (tileWidth > 0) {
                        const srcX = x % tileWidth;
                        dest[x] = src[(srcX * Texture.width / tileWidth | 0)];
                    }
                    else {
                        dest[x] = src[0];
                    }
                }
                ;
            }
        }
        return dest;
    }
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid) {
            const tileWidth = (Texture.width / this.horizontalTiles | 0);
            const tileHeight = (Texture.height / this.verticalTiles | 0);
            let src;
            if (tileHeight > 0) {
                const srcY = y % tileHeight;
                src = this.getChildColorOutput(0, (srcY * Texture.height / tileHeight | 0));
            }
            else {
                src = this.getChildColorOutput(0, 0);
            }
            const srcRed = src[0];
            const srcGreen = src[1];
            const srcBlue = src[2];
            const destRed = dest[0];
            const destGreen = dest[1];
            const destBlue = dest[2];
            for (let x = 0; x < Texture.width; x++) {
                {
                    let index;
                    if (tileWidth <= 0) {
                        index = 0;
                    }
                    else {
                        const srcX = x % tileWidth;
                        index = (Texture.width * srcX / tileWidth | 0);
                    }
                    destRed[x] = srcRed[index];
                    destGreen[x] = srcGreen[index];
                    destBlue[x] = srcBlue[index];
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpTile["__class"] = "TextureOpTile";
class TextureOpVerticalGradient extends TextureOp {
    constructor() {
        super(0, true);
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            ArrayUtils.fill$int_A$int$int$int(dest, 0, Texture.width, Texture.normalisedY[y]);
        }
        return dest;
    }
}
TextureOpVerticalGradient["__class"] = "TextureOpVerticalGradient";
class TextureOpVoronoiNoise extends TextureOp {
    constructor() {
        super(0, true);
        this.aShortArray81 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(512);
        this.anInt4553 = 2;
        this.anInt4552 = 2048;
        this.seed = 0;
        this.anInt4548 = 1;
        this.anInt4551 = 5;
        this.permutation = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(512);
        this.anInt4557 = 5;
    }
    postDecode() {
        this.permutation = TextureOp.getPermutation(this.seed);
        this.method3715();
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local30 = Texture.normalisedY[y] * this.anInt4557 + 2048;
            const local34 = local30 >> 12;
            const local38 = local34 + 1;
            for (let x = 0; x < Texture.width; x++) {
                {
                    TextureOpVoronoiNoise.anInt5205 = 2147483647;
                    TextureOpVoronoiNoise.anInt2979 = 2147483647;
                    TextureOpVoronoiNoise.anInt2464 = 2147483647;
                    TextureOpVoronoiNoise.anInt4260 = 2147483647;
                    const local65 = Texture.normalisedX[x] * this.anInt4551 + 2048;
                    const local69 = local65 >> 12;
                    const local73 = local69 + 1;
                    for (let local77 = local34 - 1; local77 <= local38; local77++) {
                        {
                            const local106 = this.permutation[(local77 >= this.anInt4557 ? local77 - this.anInt4557 : local77) & 255] & 255;
                            for (let local110 = local69 - 1; local110 <= local73; local110++) {
                                {
                                    let local137 = (this.permutation[local106 + (this.anInt4551 <= local110 ? local110 - this.anInt4551 : local110) & 255] & 255) * 2;
                                    const local151 = local65 - (local110 << 12) - this.aShortArray81[local137++];
                                    const local164 = local30 - (local77 << 12) - this.aShortArray81[local137];
                                    const local167 = this.anInt4548;
                                    let local203;
                                    if (local167 === 1) {
                                        local203 = local164 * local164 + local151 * local151 >> 12;
                                    }
                                    else if (local167 === 3) {
                                        const local213 = local151 >= 0 ? local151 : -local151;
                                        const local220 = local164 < 0 ? -local164 : local164;
                                        local203 = local220 >= local213 ? local220 : local213;
                                    }
                                    else if (local167 === 4) {
                                        const local244 = ((Math.sqrt((Math.fround((local151 < 0 ? -local151 : local151) / 4096.0))) * 4096.0) | 0);
                                        const local262 = ((Math.sqrt((Math.fround((local164 >= 0 ? local164 : -local164) / 4096.0))) * 4096.0) | 0);
                                        const local266 = local262 + local244;
                                        local203 = local266 * local266 >> 12;
                                    }
                                    else if (local167 === 5) {
                                        const local278 = local151 * local151;
                                        const local282 = local164 * local164;
                                        local203 = ((Math.sqrt(Math.sqrt((Math.fround((local278 + local282) / 1.6777216E7)))) * 4096.0) | 0);
                                    }
                                    else if (local167 === 2) {
                                        local203 = (local151 < 0 ? -local151 : local151) + (local164 >= 0 ? local164 : -local164);
                                    }
                                    else {
                                        local203 = ((Math.sqrt((Math.fround((local151 * local151 + local164 * local164) / 1.6777216E7))) * 4096.0) | 0);
                                    }
                                    if (local203 < TextureOpVoronoiNoise.anInt4260) {
                                        TextureOpVoronoiNoise.anInt5205 = TextureOpVoronoiNoise.anInt2979;
                                        TextureOpVoronoiNoise.anInt2979 = TextureOpVoronoiNoise.anInt2464;
                                        TextureOpVoronoiNoise.anInt2464 = TextureOpVoronoiNoise.anInt4260;
                                        TextureOpVoronoiNoise.anInt4260 = local203;
                                    }
                                    else if (local203 < TextureOpVoronoiNoise.anInt2464) {
                                        TextureOpVoronoiNoise.anInt5205 = TextureOpVoronoiNoise.anInt2979;
                                        TextureOpVoronoiNoise.anInt2979 = TextureOpVoronoiNoise.anInt2464;
                                        TextureOpVoronoiNoise.anInt2464 = local203;
                                    }
                                    else if (local203 < TextureOpVoronoiNoise.anInt2979) {
                                        TextureOpVoronoiNoise.anInt5205 = TextureOpVoronoiNoise.anInt2979;
                                        TextureOpVoronoiNoise.anInt2979 = local203;
                                    }
                                    else if (TextureOpVoronoiNoise.anInt5205 > local203) {
                                        TextureOpVoronoiNoise.anInt5205 = local203;
                                    }
                                }
                                ;
                            }
                        }
                        ;
                    }
                    const local390 = this.anInt4553;
                    if (local390 === 0) {
                        dest[x] = TextureOpVoronoiNoise.anInt4260;
                    }
                    else if (local390 === 1) {
                        dest[x] = TextureOpVoronoiNoise.anInt2464;
                    }
                    else if (local390 === 3) {
                        dest[x] = TextureOpVoronoiNoise.anInt2979;
                    }
                    else if (local390 === 4) {
                        dest[x] = TextureOpVoronoiNoise.anInt5205;
                    }
                    else if (local390 === 2) {
                        dest[x] = TextureOpVoronoiNoise.anInt2464 - TextureOpVoronoiNoise.anInt4260;
                    }
                }
                ;
            }
        }
        return dest;
    }
    /*private*/ method3715() {
        const random = new Random(this.seed);
        this.aShortArray81 = (s => { let a = []; while (s-- > 0)
            a.push(0); return a; })(512);
        if (this.anInt4552 > 0) {
            for (let local27 = 0; local27 < 512; local27++) {
                {
                    this.aShortArray81[local27] = (RandomUtils.nextInt(random, this.anInt4552) | 0);
                }
                ;
            }
        }
    }
    decode(buffer, code) {
        if (code === 0) {
            this.anInt4551 = this.anInt4557 = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.seed = buffer.readUnsignedByte();
        }
        else if (code === 2) {
            this.anInt4552 = buffer.readUnsignedShort();
        }
        else if (code === 3) {
            this.anInt4553 = buffer.readUnsignedByte();
        }
        else if (code === 4) {
            this.anInt4548 = buffer.readUnsignedByte();
        }
        else if (code === 5) {
            this.anInt4551 = buffer.readUnsignedByte();
        }
        else if (code === 6) {
            this.anInt4557 = buffer.readUnsignedByte();
        }
    }
}
TextureOpVoronoiNoise.anInt5205 = 0;
TextureOpVoronoiNoise.anInt2979 = 0;
TextureOpVoronoiNoise.anInt2464 = 0;
TextureOpVoronoiNoise.anInt4260 = 0;
TextureOpVoronoiNoise["__class"] = "TextureOpVoronoiNoise";
class TextureOpWaveform extends TextureOp {
    constructor() {
        super(0, true);
        this.shape = 0;
        this.frequency = 1;
        this.waveform = 0;
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local26 = Texture.normalisedY[y];
            const local32 = local26 - 2048 >> 1;
            for (let x = 0; x < Texture.width; x++) {
                {
                    const local41 = Texture.normalisedX[x];
                    const local47 = local41 - 2048 >> 1;
                    let local79;
                    if (this.shape === 0) {
                        local79 = (local41 - local26) * this.frequency;
                    }
                    else {
                        const local60 = local32 * local32 + local47 * local47 >> 12;
                        const local70 = ((Math.sqrt(Math.fround(local60 / 4096.0)) * 4096.0) | 0);
                        local79 = (((this.frequency * local70) * 3.141592653589793) | 0);
                    }
                    let local95 = local79 - (local79 & -4096);
                    if (this.waveform === 0) {
                        local95 = TextureOp.SINE[local95 >> 4 & 255] + 4096 >> 1;
                    }
                    else if (this.waveform === 2) {
                        let local118 = local95 - 2048;
                        if (local118 < 0) {
                            local118 = -local118;
                        }
                        local95 = 2048 - local118 << 1;
                    }
                    dest[x] = local95;
                }
                ;
            }
        }
        return dest;
    }
    postDecode() {
        TextureOp.createTrigonometryTables();
    }
    decode(buffer, code) {
        if (code === 0) {
            this.shape = buffer.readUnsignedByte();
        }
        else if (code === 1) {
            this.waveform = buffer.readUnsignedByte();
        }
        else if (code === 3) {
            this.frequency = buffer.readUnsignedByte();
        }
    }
}
TextureOpWaveform["__class"] = "TextureOpWaveform";
class TextureOpWeave extends TextureOp {
    constructor() {
        super(0, true);
        this.thickness = 585;
    }
    decode(buffer, code) {
        if (code === 0) {
            this.thickness = buffer.readUnsignedShort();
        }
    }
    getMonochromeOutput(y) {
        const dest = this.monochromeImageCache.get$int(y);
        if (this.monochromeImageCache.invalid) {
            const local27 = Texture.normalisedY[y];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const local40 = Texture.normalisedX[x];
                    if (this.thickness < local40 && 4096 - this.thickness > local40 && local27 > 2048 - this.thickness && this.thickness + 2048 > local27) {
                        let local78 = 2048 - local40;
                        local78 = local78 < 0 ? -local78 : local78;
                        local78 <<= 12;
                        local78 = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(local78 / 2048 - this.thickness);
                        dest[x] = 4096 - local78;
                    }
                    else if (2048 - this.thickness < local40 && this.thickness + 2048 > local40) {
                        let local127 = local27 - 2048;
                        local127 = local127 >= 0 ? local127 : -local127;
                        local127 -= this.thickness;
                        local127 <<= 12;
                        dest[x] = (local127 / (2048 - this.thickness) | 0);
                    }
                    else if (local27 < this.thickness || local27 > 4096 - this.thickness) {
                        let local180 = local40 - 2048;
                        local180 = local180 < 0 ? -local180 : local180;
                        local180 -= this.thickness;
                        local180 <<= 12;
                        dest[x] = (local180 / (2048 - this.thickness) | 0);
                    }
                    else if (this.thickness <= local40 && local40 <= 4096 - this.thickness) {
                        dest[x] = 0;
                    }
                    else {
                        let local236 = 2048 - local27;
                        local236 = local236 < 0 ? -local236 : local236;
                        local236 <<= 12;
                        local236 = (n => n < 0 ? Math.ceil(n) : Math.floor(n))(local236 / 2048 - this.thickness);
                        dest[x] = 4096 - local236;
                    }
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpWeave["__class"] = "TextureOpWeave";
class TextureOpTiledSprite extends TextureOpSprite {
    getColorOutput(y) {
        const dest = this.colorImageCache.get$int(y);
        if (this.colorImageCache.invalid && this.loadSprite()) {
            const destGreen = dest[1];
            const destBlue = dest[2];
            const srcY = this.height * (y % this.height);
            const destRed = dest[0];
            for (let x = 0; x < Texture.width; x++) {
                {
                    const color = this.pixels[srcY + x % this.width];
                    destBlue[x] = (color & 255) << 4;
                    destGreen[x] = color >> 4 & 4080;
                    destRed[x] = color >> 12 & 4080;
                }
                ;
            }
        }
        return dest;
    }
}
TextureOpTiledSprite["__class"] = "TextureOpTiledSprite";
MonochromeImageCache.PERLIN_FADE_$LI$();
MonochromeImageCache.__static_initialize();
Texture.brightnessMap_$LI$();
TextureOp.permutations_$LI$();
MonochromeImageCacheEntry.VALID_$LI$();
ColorImageCacheEntry.VALID_$LI$();
TextureMathUtils.INVERSE_SQUARE_ROOT_$LI$();
TextureMathUtils.__static_initialize();
Random.twoToTheXMinus48_$LI$();
Random.twoToTheXMinus24_$LI$();
Random.__static_initialize();
BufferPool.largeBuffers_$LI$();
BufferPool.mediumBuffers_$LI$();
BufferPool.smallBuffers_$LI$();


//////////////////////////////////////////////////////////////////
////////////////////// end of generated code /////////////////////
//////////////////////////////////////////////////////////////////



module.exports={
    Texture,
    Buffer
}
})()