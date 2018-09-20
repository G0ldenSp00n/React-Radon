class SiloNode {
  constructor(name, val, parent = null, modifiers = {}, type = 'PRIMITIVE') {
    this._name = name;
    this._value = val;
    this._modifiers = modifiers;
    this._queue = [];
    this._subscribers = [];
    this._parent = parent; // circular silo node
    this._type = type;

    // bind
    this.linkModifiers = this.linkModifiers.bind(this);
    this.runModifiers = this.runModifiers.bind(this);
    this.notifySubscribers = this.notifySubscribers.bind(this);
    this.getState = this.getState.bind(this);
    this.runLinkModifiers = this.runLinkModifiers.bind(this);
    this.handleArray = this.handleArray.bind(this);
    this.handleObject = this.handleObject.bind(this);
    this.updateSilo = this.updateSilo.bind(this);
    this.handle = this.handle.bind(this);

    // invoke functions
    this.runQueue = this.runModifiers();
  }

  get name() {
    return this._name;
  }

  set name(name) {
    this._name = name;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    console.log("New Value -", value);
    this._value = value;
  }

  get modifiers() {
    return this._modifiers;
  }

  get queue() {
    return this._queue;
  }

  get parent() {
    return this._parent;
  }

  // set subscribers() {
  //   return this._subscribers;
  // }

  get subscribers() {
    return this._subscribers;
  }

  get type() {
    return this._type;
  }

  notifySubscribers() {
    if (this.subscribers.length === 0) return;
    this.subscribers.forEach(func => {
      if (typeof func !== 'function') throw new Error('subscriber array must only contain functions');
      func(this.getState(this));
    })
  }

  runModifiers() {
    let running = false; // prevents multiple calls from being made if already running

    async function run() {
      if (running === false) { // prevents multiple calls from being made if already running
        running = true;
  
        while (this.queue.length > 0) {
          this.value = await this.queue.shift()();
          if (this.type !== 'PRIMITIVE') this.value = this.updateSilo().value;
          this.notifySubscribers();
        }

        running = false;   
      } else {
        return 'in progress...';
      }
    }
    return run;
  }

  updateSilo(objName = this.name, obj = this, parent = this.parent) {
    const objChildren = {};
    let type, keys;
  
    // determine if array or other object
    if (Array.isArray(obj.value)) {
      keys = obj.value;
      type = 'ARRAY';
    } else {
      keys = Object.keys(obj.value);
      type = 'OBJECT'
    }
  
    const node = new SiloNode(objName, objChildren, parent, obj.modifiers, type);
    
    if (Array.isArray(obj.value) && obj.value.length > 0) {
      obj.value.forEach((val, i) => {
        if (typeof val === 'object') objChildren[`${objName}_${i}`] = this.updateSilo(`${objName}_${i}`, {value: val}, node);
        else objChildren[`${objName}_${i}`] = new SiloNode(`${objName}_${i}`, val, node);
      })
    } 
    
    else if (keys.length > 0) {
      keys.forEach(key => {
        if (typeof obj.value[key] === 'object') objChildren[`${objName}_${key}`] = this.updateSilo(key, {value: obj.value[key]}, node);
        else objChildren[`${objName}_${key}`] = new SiloNode(`${objName}_${key}`, obj.value[key], node);
      })
    }

    node.value = objChildren;
    return node;
  }

  runLinkModifiers(nodeName) {
    // this.name = nodeName;
    this.linkModifiers(nodeName, this.modifiers);
  }

  linkModifiers(nodeName, stateModifiers) {
    if (!stateModifiers || Object.keys(stateModifiers).length === 0) return;
    //const that = this;
    // looping through every modifier added by the dev
    Object.keys(stateModifiers).forEach((modifierKey => {
      const modifier = stateModifiers[modifierKey];

      if (typeof modifier !== 'function' ) throw new TypeError(); 

      // adds middleware that will affect the value of this node
      else if (modifier.length <= 2) {
        // wrap the dev's modifier function so we can pass the current node value into it
        let linkedModifier;
        if (this.type === 'PRIMITIVE') {linkedModifier = async (payload) => await modifier(this.value, payload);} 
        // that.value is an object and we need to reassemble it
        else if (this.type === 'OBJECT') {
          const value = handleObject(nodeName, this);
          linkedModifier = async (payload) => await modifier(value, payload);
        }
        else if (this.type === 'ARRAY') {
          const value = this.handleArray(nodeName, this);
          linkedModifier = async (payload) => await modifier(value, payload);
        }

        // the function that will be called when the dev tries to call their modifier
        stateModifiers[modifierKey] = payload => {
          // wrap the linkedModifier again so that it can be added to the async queue without being invoked
          const callback = async () => await linkedModifier(payload);
          this.queue.push(callback);
          this.runQueue();
        }
      }

      // adds middleware that will affect the value of a child node of index
      else if (modifier.length > 2) {
        // wrap the dev's modifier function so we can pass the current node value into it
        const linkedModifier = async (index, payload) => await modifier(this.handle(this.value[index], index), index, payload); 

        // the function that will be called when the dev tries to call their modifier
        stateModifiers[modifierKey] = (index, payload) => {
          // wrap the linkedModifier again so that it can be added to the async queue without being invoked
          const callback = async () => await linkedModifier(`${this.name}_${index}`, payload);
          this.value[`${this.name}_${index}`].queue.push(callback);
          this.value[`${this.name}_${index}`].runQueue();
        }
      }
    }).bind(this))
  }

  handle(node, name) {
    let handledObj;
    if (node.type === 'OBJECT') handledObj = this.handleObject(name, node);
    else if (node.type === 'ARRAY') handledObj = this.handleArray(name, node);
    else return node.value;
    return handledObj;
  }

  handleObject(name, obj) {
    const newObject = {};

    // loop through object values currently stored as nodes
    Object.keys(obj.value).forEach(key => {
      const childObj = obj.value[key];
      //get keyName from the naming convention
      const extractedKey = key.slice(name.length + 1);
      if (childObj.type === 'OBJECT') {
        newObject[extractedKey] = this.handleObject(key, childObj);
      } else if (childObj.type === 'ARRAY') {
        newObject[extractedKey] = this.handleArray(key, childObj);
      } else if (childObj.type === 'PRIMITIVE') {
        newObject[extractedKey] = childObj.value;
      }
    })
    return newObject;
  }

  handleArray(name, obj) {
    console.log('THIS IS THE OBJ', obj/*obj.getState(obj)*/);
    //obj = obj.getState();
    const newArray = [];
    // loop through array indices currently stored as nodes
    console.log("THIS IS OBJ", obj);
    Object.keys(obj.value).forEach((key, i) => {
      const childObj = obj.value[key];
      if(childObj.value.marketList_0_cards){
      console.log("CHILD OBJ", childObj.value.marketList_0_cards.value);
      }
      if (childObj.type === 'ARRAY') {
        newArray.push(this.handleArray(`${name}_${i}`, childObj));
      } else if (childObj.type === 'OBJECT') {
        newArray.push(this.handleObject(`${name}_${i}`, childObj))
      } else if (childObj.type === 'PRIMITIVE') {
        console.log(childObj);
        newArray.push(childObj.value);
      }
    })
    return newArray;
  }

  getState(currentNode = this) {
    const state = {};
    // recurse to root and collect all variables/modifiers from parents
    if (currentNode.parent !== 'root' && currentNode.parent !== null) {
      const parentData = this.getState(currentNode.parent);
      Object.keys(parentData).forEach(key => {
        state[key] = parentData[key];
      })
    }

    // getting children of objects is redundant
    if (currentNode.type !== 'ARRAY' && currentNode.type !== 'OBJECT')
      Object.keys(currentNode.value).forEach(key => {
        const node = currentNode.value[key];
        if (node.type === 'OBJECT') state[key] = this.handleObject(key, node);
        else if (node.type === 'ARRAY') {
          state[key] = this.handleArray(key, node);
        }
        else if (node.type === 'PRIMITIVE') state[key] = node.value;

        if (node.modifiers) {
          Object.keys(node.modifiers).forEach(modifier => {
            state[modifier] = node.modifiers[modifier];
          })
        }
      })

    return state;
  }
}

export default SiloNode;

// module.exports = SiloNode;